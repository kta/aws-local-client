use aws_smithy_runtime_api::client::result::SdkError;
use aws_smithy_runtime_api::http::Response;
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum AppError {
    Connection(String),
    NotFound(String),
    Validation(String),
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Connection(m) => write!(f, "connection error: {m}"),
            AppError::NotFound(m) => write!(f, "not found: {m}"),
            AppError::Validation(m) => write!(f, "validation error: {m}"),
            AppError::Internal(m) => write!(f, "internal error: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

pub fn map_sdk_err<E>(err: SdkError<E, Response>) -> AppError
where
    E: aws_sdk_dynamodb::error::ProvideErrorMetadata + std::fmt::Debug,
{
    match &err {
        SdkError::DispatchFailure(_) | SdkError::TimeoutError(_) => {
            AppError::Connection(format!("{err:?}"))
        }
        SdkError::ServiceError(se) => {
            let code = se.err().code().unwrap_or("");
            let msg = se
                .err()
                .message()
                .map(String::from)
                .unwrap_or_else(|| format!("{:?}", se.err()));
            match code {
                "ResourceNotFoundException" => AppError::NotFound(msg),
                "ValidationException"
                | "ConditionalCheckFailedException"
                | "ResourceInUseException" => AppError::Validation(msg),
                _ => AppError::Internal(format!("{code}: {msg}")),
            }
        }
        _ => AppError::Internal(format!("{err:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_with_kind_and_message() {
        let e = AppError::Connection("refused".into());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "connection");
        assert_eq!(json["message"], "refused");
    }
}
