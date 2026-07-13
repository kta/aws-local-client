use std::collections::HashMap;

use aws_sdk_dynamodb::primitives::Blob;
use aws_sdk_dynamodb::types::AttributeValue;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Map, Value};

use crate::error::AppError;

pub fn attr_to_json(av: &AttributeValue) -> Value {
    match av {
        AttributeValue::S(s) => json!({"S": s}),
        AttributeValue::N(n) => json!({"N": n}),
        AttributeValue::Bool(b) => json!({"BOOL": b}),
        AttributeValue::Null(_) => json!({"NULL": true}),
        AttributeValue::B(b) => json!({"B": B64.encode(b.as_ref())}),
        AttributeValue::Ss(v) => json!({"SS": v}),
        AttributeValue::Ns(v) => json!({"NS": v}),
        AttributeValue::Bs(v) => {
            json!({"BS": v.iter().map(|b| B64.encode(b.as_ref())).collect::<Vec<_>>()})
        }
        AttributeValue::L(l) => json!({"L": l.iter().map(attr_to_json).collect::<Vec<_>>()}),
        AttributeValue::M(m) => {
            let obj: Map<String, Value> = m
                .iter()
                .map(|(k, v)| (k.clone(), attr_to_json(v)))
                .collect();
            json!({"M": obj})
        }
        other => json!({"NULL": true, "_unsupported": format!("{other:?}")}),
    }
}

pub fn json_to_attr(v: &Value) -> Result<AttributeValue, AppError> {
    let obj = v.as_object().ok_or_else(|| bad(v))?;
    if obj.len() != 1 {
        return Err(bad(v));
    }
    let (tag, inner) = obj.iter().next().unwrap();
    match (tag.as_str(), inner) {
        ("S", Value::String(s)) => Ok(AttributeValue::S(s.clone())),
        ("N", Value::String(n)) => Ok(AttributeValue::N(n.clone())),
        ("BOOL", Value::Bool(b)) => Ok(AttributeValue::Bool(*b)),
        ("NULL", _) => Ok(AttributeValue::Null(true)),
        ("B", Value::String(b64)) => Ok(AttributeValue::B(Blob::new(
            B64.decode(b64)
                .map_err(|e| AppError::Validation(e.to_string()))?,
        ))),
        ("SS", Value::Array(a)) => Ok(AttributeValue::Ss(str_vec(a, v)?)),
        ("NS", Value::Array(a)) => Ok(AttributeValue::Ns(str_vec(a, v)?)),
        ("BS", Value::Array(a)) => {
            let blobs = str_vec(a, v)?
                .iter()
                .map(|s| {
                    B64.decode(s)
                        .map(Blob::new)
                        .map_err(|e| AppError::Validation(e.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AttributeValue::Bs(blobs))
        }
        ("L", Value::Array(a)) => Ok(AttributeValue::L(
            a.iter().map(json_to_attr).collect::<Result<Vec<_>, _>>()?,
        )),
        ("M", Value::Object(m)) => {
            let mut out = HashMap::new();
            for (k, mv) in m {
                out.insert(k.clone(), json_to_attr(mv)?);
            }
            Ok(AttributeValue::M(out))
        }
        _ => Err(bad(v)),
    }
}

pub fn item_to_json(item: &HashMap<String, AttributeValue>) -> Value {
    let obj: Map<String, Value> = item
        .iter()
        .map(|(k, v)| (k.clone(), attr_to_json(v)))
        .collect();
    Value::Object(obj)
}

pub fn json_to_item(v: &Value) -> Result<HashMap<String, AttributeValue>, AppError> {
    let obj = v
        .as_object()
        .ok_or_else(|| AppError::Validation("item must be a JSON object".into()))?;
    let mut out = HashMap::new();
    for (k, av) in obj {
        out.insert(k.clone(), json_to_attr(av)?);
    }
    Ok(out)
}

fn str_vec(a: &[Value], orig: &Value) -> Result<Vec<String>, AppError> {
    a.iter()
        .map(|x| x.as_str().map(String::from).ok_or_else(|| bad(orig)))
        .collect()
}

fn bad(v: &Value) -> AppError {
    AppError::Validation(format!("invalid DynamoDB JSON: {v}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scalar_roundtrip() {
        for j in [
            json!({"S": "hello"}),
            json!({"N": "42.5"}),
            json!({"BOOL": true}),
            json!({"NULL": true}),
        ] {
            let av = json_to_attr(&j).unwrap();
            assert_eq!(attr_to_json(&av), j);
        }
    }

    #[test]
    fn nested_roundtrip() {
        let j = json!({"M": {"tags": {"L": [{"S": "a"}, {"N": "1"}]}, "ok": {"BOOL": false}}});
        let av = json_to_attr(&j).unwrap();
        assert_eq!(attr_to_json(&av), j);
    }

    #[test]
    fn sets_roundtrip() {
        let j = json!({"SS": ["a", "b"]});
        assert_eq!(attr_to_json(&json_to_attr(&j).unwrap()), j);
        let j = json!({"NS": ["1", "2"]});
        assert_eq!(attr_to_json(&json_to_attr(&j).unwrap()), j);
    }

    #[test]
    fn binary_roundtrip_base64() {
        let j = json!({"B": "aGVsbG8="}); // "hello"
        assert_eq!(attr_to_json(&json_to_attr(&j).unwrap()), j);
    }

    #[test]
    fn item_roundtrip() {
        let j = json!({"pk": {"S": "user#1"}, "age": {"N": "30"}});
        let item = json_to_item(&j).unwrap();
        assert_eq!(item_to_json(&item), j);
    }

    #[test]
    fn invalid_shape_is_validation_error() {
        assert!(matches!(
            json_to_attr(&json!({"S": 1})),
            Err(crate::error::AppError::Validation(_))
        ));
        assert!(matches!(
            json_to_attr(&json!("bare string")),
            Err(crate::error::AppError::Validation(_))
        ));
    }
}
