//! CloudWatch **Metrics / Alarms** over the legacy Query protocol.
//!
//! Modern AWS SDKs speak CloudWatch with smithy-rpc-v2-cbor. localstack:3
//! rejects that with HTTP 500 `Operation detection failed. Missing Action in
//! request for query-protocol service` (verified 2026-07-22, spec §2.1-1). The
//! legacy Query protocol (`Action=...&Version=2010-08-01` form POST, XML
//! response) works on localstack / floci / ministack; kumo does not route the
//! `monitoring` service at all (`UnknownService`), which the frontend surfaces
//! as the `cloudwatch-unsupported` banner.
//!
//! This module issues the raw POST with `reqwest` and parses the XML with
//! `quick-xml` — the Rust mirror of the E2E `awsQuery` helper. CloudWatch Logs
//! use the ordinary SDK (JSON protocol) and live in `cloudwatch.rs`.

use serde::{Deserialize, Serialize};

use crate::connections::ConnectionProfile;
use crate::error::AppError;

// ---- wire types (camelCase, mirrored in src/api/cloudwatch.ts) --------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CwDimension {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetricSummary {
    pub namespace: String,
    pub name: String,
    pub dimensions: Vec<CwDimension>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Datapoint {
    pub timestamp: String,
    pub value: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMetricStatisticsRequest {
    pub namespace: String,
    pub metric_name: String,
    #[serde(default)]
    pub dimensions: Vec<CwDimensionInput>,
    pub period_sec: i64,
    /// One of Average / Sum / Maximum / Minimum / SampleCount.
    pub stat: String,
    pub start_iso: String,
    pub end_iso: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CwDimensionInput {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlarmSummary {
    pub name: String,
    pub state: String,
    pub metric_name: Option<String>,
    pub namespace: Option<String>,
    pub threshold: Option<f64>,
    pub comparison_operator: Option<String>,
    pub statistic: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMetricAlarmRequest {
    pub name: String,
    pub namespace: String,
    pub metric_name: String,
    pub stat: String,
    pub period_sec: i64,
    pub threshold: f64,
    pub comparison: String,
}

// ---- XML deserialization structs (AWS Query response shapes) ----------------

#[derive(Debug, Deserialize)]
struct ListMetricsResponse {
    #[serde(rename = "ListMetricsResult")]
    result: ListMetricsResult,
}
#[derive(Debug, Deserialize)]
struct ListMetricsResult {
    #[serde(rename = "Metrics")]
    metrics: Option<MetricMembers>,
}
#[derive(Debug, Deserialize, Default)]
struct MetricMembers {
    #[serde(rename = "member", default)]
    member: Vec<MetricXml>,
}
#[derive(Debug, Deserialize)]
struct MetricXml {
    #[serde(rename = "Namespace")]
    namespace: Option<String>,
    #[serde(rename = "MetricName")]
    metric_name: Option<String>,
    #[serde(rename = "Dimensions")]
    dimensions: Option<DimensionMembers>,
}
#[derive(Debug, Deserialize, Default)]
struct DimensionMembers {
    #[serde(rename = "member", default)]
    member: Vec<DimensionXml>,
}
#[derive(Debug, Deserialize)]
struct DimensionXml {
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "Value")]
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GetMetricStatisticsResponse {
    #[serde(rename = "GetMetricStatisticsResult")]
    result: GetMetricStatisticsResult,
}
#[derive(Debug, Deserialize)]
struct GetMetricStatisticsResult {
    #[serde(rename = "Datapoints")]
    datapoints: Option<DatapointMembers>,
}
#[derive(Debug, Deserialize, Default)]
struct DatapointMembers {
    #[serde(rename = "member", default)]
    member: Vec<DatapointXml>,
}
#[derive(Debug, Deserialize)]
struct DatapointXml {
    #[serde(rename = "Timestamp")]
    timestamp: Option<String>,
    #[serde(rename = "Average")]
    average: Option<f64>,
    #[serde(rename = "Sum")]
    sum: Option<f64>,
    #[serde(rename = "Maximum")]
    maximum: Option<f64>,
    #[serde(rename = "Minimum")]
    minimum: Option<f64>,
    #[serde(rename = "SampleCount")]
    sample_count: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DescribeAlarmsResponse {
    #[serde(rename = "DescribeAlarmsResult")]
    result: DescribeAlarmsResult,
}
#[derive(Debug, Deserialize)]
struct DescribeAlarmsResult {
    #[serde(rename = "MetricAlarms")]
    metric_alarms: Option<AlarmMembers>,
}
#[derive(Debug, Deserialize, Default)]
struct AlarmMembers {
    #[serde(rename = "member", default)]
    member: Vec<AlarmXml>,
}
#[derive(Debug, Deserialize)]
struct AlarmXml {
    #[serde(rename = "AlarmName")]
    alarm_name: Option<String>,
    #[serde(rename = "StateValue")]
    state_value: Option<String>,
    #[serde(rename = "MetricName")]
    metric_name: Option<String>,
    #[serde(rename = "Namespace")]
    namespace: Option<String>,
    #[serde(rename = "Threshold")]
    threshold: Option<f64>,
    #[serde(rename = "ComparisonOperator")]
    comparison_operator: Option<String>,
    #[serde(rename = "Statistic")]
    statistic: Option<String>,
}

// ---- Query transport --------------------------------------------------------

/// Pick the datapoint value column matching the requested statistic.
fn datapoint_value(d: &DatapointXml, stat: &str) -> Option<f64> {
    match stat {
        "Sum" => d.sum,
        "Maximum" => d.maximum,
        "Minimum" => d.minimum,
        "SampleCount" => d.sample_count,
        // Average is the default / most common statistic.
        _ => d.average,
    }
}

/// Extract a human-readable message from an emulator error body (JSON `message`
/// or XML `<Message>`), so unsupported detection and the banner have text.
fn extract_error_message(body: &str) -> String {
    if let Some(rest) = body.split("\"message\":").nth(1) {
        // JSON: "message":"..."
        if let Some(start) = rest.find('"') {
            if let Some(end) = rest[start + 1..].find('"') {
                return rest[start + 1..start + 1 + end].to_string();
            }
        }
    }
    if let Some(rest) = body.split("<Message>").nth(1) {
        if let Some(end) = rest.find("</Message>") {
            return rest[..end].to_string();
        }
    }
    body.chars().take(300).collect()
}

/// Issue a CloudWatch Query-protocol POST and return the XML body on success.
/// Non-2xx responses (and JSON error bodies from kumo) become an `AppError`
/// whose message carries the emulator's own text for unsupported detection.
async fn query(
    profile: &ConnectionProfile,
    action: &str,
    params: Vec<(String, String)>,
) -> Result<String, AppError> {
    let base = profile.endpoint_url.trim_end_matches('/');
    let url = format!("{base}/");
    let mut form: Vec<(String, String)> = vec![
        ("Action".to_string(), action.to_string()),
        ("Version".to_string(), "2010-08-01".to_string()),
    ];
    form.extend(params);

    // Emulators do not verify signatures but some route by credential scope; the
    // `api/monitoring` UA token disambiguates the CloudWatch action namespace.
    let auth = format!(
        "AWS4-HMAC-SHA256 Credential=dummy/20260101/{}/monitoring/aws4_request, \
         SignedHeaders=host, Signature=dummy",
        profile.region
    );

    let resp = reqwest::Client::new()
        .post(&url)
        .header(
            "content-type",
            "application/x-www-form-urlencoded; charset=utf-8",
        )
        .header("user-agent", "aws-sdk-js/3.0 api/monitoring#3.0")
        .header("authorization", auth)
        .form(&form)
        .send()
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    if !status.is_success() || body.contains("<Error>") || body.contains("<ErrorResponse") {
        return Err(AppError::Internal(extract_error_message(&body)));
    }
    Ok(body)
}

/// Emit repeated Query-protocol list members: `Prefix.member.N.Suffix=value`.
fn member_param(prefix: &str, idx: usize, suffix: &str) -> String {
    if suffix.is_empty() {
        format!("{prefix}.member.{idx}")
    } else {
        format!("{prefix}.member.{idx}.{suffix}")
    }
}

// ---- core operations (parse-only tested via the XML fixtures below) ----------

fn parse_list_metrics(xml: &str) -> Result<Vec<MetricSummary>, AppError> {
    let parsed: ListMetricsResponse =
        quick_xml::de::from_str(xml).map_err(|e| AppError::Internal(e.to_string()))?;
    let members = parsed.result.metrics.unwrap_or_default().member;
    Ok(members
        .into_iter()
        .map(|m| MetricSummary {
            namespace: m.namespace.unwrap_or_default(),
            name: m.metric_name.unwrap_or_default(),
            dimensions: m
                .dimensions
                .unwrap_or_default()
                .member
                .into_iter()
                .map(|d| CwDimension {
                    name: d.name.unwrap_or_default(),
                    value: d.value.unwrap_or_default(),
                })
                .collect(),
        })
        .collect())
}

fn parse_datapoints(xml: &str, stat: &str) -> Result<Vec<Datapoint>, AppError> {
    let parsed: GetMetricStatisticsResponse =
        quick_xml::de::from_str(xml).map_err(|e| AppError::Internal(e.to_string()))?;
    let members = parsed.result.datapoints.unwrap_or_default().member;
    let mut points: Vec<Datapoint> = members
        .into_iter()
        .map(|d| Datapoint {
            timestamp: d.timestamp.clone().unwrap_or_default(),
            value: datapoint_value(&d, stat).unwrap_or(0.0),
        })
        .collect();
    // CloudWatch returns datapoints unordered; sort ascending by timestamp.
    points.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(points)
}

fn parse_alarms(xml: &str) -> Result<Vec<AlarmSummary>, AppError> {
    let parsed: DescribeAlarmsResponse =
        quick_xml::de::from_str(xml).map_err(|e| AppError::Internal(e.to_string()))?;
    let members = parsed.result.metric_alarms.unwrap_or_default().member;
    Ok(members
        .into_iter()
        .map(|a| AlarmSummary {
            name: a.alarm_name.unwrap_or_default(),
            state: a.state_value.unwrap_or_default(),
            metric_name: a.metric_name,
            namespace: a.namespace,
            threshold: a.threshold,
            comparison_operator: a.comparison_operator,
            statistic: a.statistic,
        })
        .collect())
}

pub async fn list_metrics(
    profile: &ConnectionProfile,
    namespace: Option<String>,
) -> Result<Vec<MetricSummary>, AppError> {
    let mut params = vec![];
    if let Some(ns) = namespace {
        if !ns.trim().is_empty() {
            params.push(("Namespace".to_string(), ns));
        }
    }
    let xml = query(profile, "ListMetrics", params).await?;
    parse_list_metrics(&xml)
}

pub async fn get_metric_statistics(
    profile: &ConnectionProfile,
    req: &GetMetricStatisticsRequest,
) -> Result<Vec<Datapoint>, AppError> {
    let mut params = vec![
        ("Namespace".to_string(), req.namespace.clone()),
        ("MetricName".to_string(), req.metric_name.clone()),
        ("StartTime".to_string(), req.start_iso.clone()),
        ("EndTime".to_string(), req.end_iso.clone()),
        ("Period".to_string(), req.period_sec.to_string()),
        (member_param("Statistics", 1, ""), req.stat.clone()),
    ];
    for (i, d) in req.dimensions.iter().enumerate() {
        params.push((member_param("Dimensions", i + 1, "Name"), d.name.clone()));
        params.push((member_param("Dimensions", i + 1, "Value"), d.value.clone()));
    }
    let xml = query(profile, "GetMetricStatistics", params).await?;
    parse_datapoints(&xml, &req.stat)
}

pub async fn describe_alarms(profile: &ConnectionProfile) -> Result<Vec<AlarmSummary>, AppError> {
    let xml = query(profile, "DescribeAlarms", vec![]).await?;
    parse_alarms(&xml)
}

pub async fn put_metric_alarm(
    profile: &ConnectionProfile,
    req: &PutMetricAlarmRequest,
) -> Result<(), AppError> {
    let params = vec![
        ("AlarmName".to_string(), req.name.clone()),
        ("Namespace".to_string(), req.namespace.clone()),
        ("MetricName".to_string(), req.metric_name.clone()),
        ("Statistic".to_string(), req.stat.clone()),
        ("Period".to_string(), req.period_sec.to_string()),
        ("Threshold".to_string(), req.threshold.to_string()),
        ("ComparisonOperator".to_string(), req.comparison.clone()),
        ("EvaluationPeriods".to_string(), "1".to_string()),
    ];
    query(profile, "PutMetricAlarm", params).await?;
    Ok(())
}

pub async fn delete_alarms(profile: &ConnectionProfile, names: &[String]) -> Result<(), AppError> {
    let params: Vec<(String, String)> = names
        .iter()
        .enumerate()
        .map(|(i, n)| (member_param("AlarmNames", i + 1, ""), n.clone()))
        .collect();
    query(profile, "DeleteAlarms", params).await?;
    Ok(())
}

// ---- Tauri commands ---------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_list_metrics(
    profile: ConnectionProfile,
    namespace: Option<String>,
) -> Result<Vec<MetricSummary>, AppError> {
    list_metrics(&profile, namespace).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_get_metric_statistics(
    profile: ConnectionProfile,
    req: GetMetricStatisticsRequest,
) -> Result<Vec<Datapoint>, AppError> {
    get_metric_statistics(&profile, &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_describe_alarms(profile: ConnectionProfile) -> Result<Vec<AlarmSummary>, AppError> {
    describe_alarms(&profile).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_put_metric_alarm(
    profile: ConnectionProfile,
    req: PutMetricAlarmRequest,
) -> Result<(), AppError> {
    put_metric_alarm(&profile, &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_delete_alarms(
    profile: ConnectionProfile,
    names: Vec<String>,
) -> Result<(), AppError> {
    delete_alarms(&profile, &names).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST_METRICS_XML: &str = r#"<?xml version='1.0' encoding='utf-8'?>
<ListMetricsResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/"><ListMetricsResult><Metrics><member><Namespace>NLSD/E2E</Namespace><MetricName>Probe</MetricName><Dimensions><member><Name>Host</Name><Value>h1</Value></member></Dimensions></member></Metrics></ListMetricsResult><ResponseMetadata><RequestId>x</RequestId></ResponseMetadata></ListMetricsResponse>"#;

    const STATS_XML: &str = r#"<?xml version='1.0' encoding='utf-8'?>
<GetMetricStatisticsResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/"><GetMetricStatisticsResult><Datapoints><member><Timestamp>2026-07-22T05:51:34Z</Timestamp><Average>42.0</Average><Sum>84</Sum><Maximum>50</Maximum><Unit>None</Unit></member></Datapoints><Label>Probe</Label></GetMetricStatisticsResult><ResponseMetadata><RequestId>x</RequestId></ResponseMetadata></GetMetricStatisticsResponse>"#;

    const ALARMS_XML: &str = r#"<?xml version='1.0' encoding='utf-8'?>
<DescribeAlarmsResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/"><DescribeAlarmsResult><CompositeAlarms /><MetricAlarms><member><AlarmName>a1</AlarmName><MetricName>Probe</MetricName><Namespace>NLSD/E2E</Namespace><Statistic>Average</Statistic><Period>60</Period><Threshold>10.0</Threshold><ComparisonOperator>GreaterThanThreshold</ComparisonOperator><StateValue>INSUFFICIENT_DATA</StateValue><Dimensions /></member></MetricAlarms></DescribeAlarmsResult></DescribeAlarmsResponse>"#;

    const EMPTY_ALARMS_XML: &str = r#"<?xml version='1.0' encoding='utf-8'?>
<DescribeAlarmsResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/"><DescribeAlarmsResult><CompositeAlarms /><MetricAlarms /></DescribeAlarmsResult></DescribeAlarmsResponse>"#;

    #[test]
    fn parses_list_metrics_with_dimensions() {
        let metrics = parse_list_metrics(LIST_METRICS_XML).unwrap();
        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].namespace, "NLSD/E2E");
        assert_eq!(metrics[0].name, "Probe");
        assert_eq!(
            metrics[0].dimensions,
            vec![CwDimension {
                name: "Host".into(),
                value: "h1".into()
            }]
        );
    }

    #[test]
    fn parses_datapoints_by_requested_stat() {
        let avg = parse_datapoints(STATS_XML, "Average").unwrap();
        assert_eq!(avg.len(), 1);
        assert_eq!(avg[0].timestamp, "2026-07-22T05:51:34Z");
        assert_eq!(avg[0].value, 42.0);
        assert_eq!(parse_datapoints(STATS_XML, "Sum").unwrap()[0].value, 84.0);
        assert_eq!(
            parse_datapoints(STATS_XML, "Maximum").unwrap()[0].value,
            50.0
        );
    }

    #[test]
    fn parses_alarms() {
        let alarms = parse_alarms(ALARMS_XML).unwrap();
        assert_eq!(alarms.len(), 1);
        assert_eq!(alarms[0].name, "a1");
        assert_eq!(alarms[0].state, "INSUFFICIENT_DATA");
        assert_eq!(alarms[0].metric_name.as_deref(), Some("Probe"));
        assert_eq!(alarms[0].threshold, Some(10.0));
        assert_eq!(
            alarms[0].comparison_operator.as_deref(),
            Some("GreaterThanThreshold")
        );
    }

    #[test]
    fn parses_empty_alarm_list() {
        assert_eq!(parse_alarms(EMPTY_ALARMS_XML).unwrap(), vec![]);
    }

    #[test]
    fn extracts_json_error_message() {
        let body = r#"{"__type":"UnknownService","message":"Unknown service: monitoring"}"#;
        assert_eq!(extract_error_message(body), "Unknown service: monitoring");
    }

    #[test]
    fn extracts_xml_error_message() {
        let body = "<ErrorResponse><Error><Code>InternalError</Code><Message>boom happened</Message></Error></ErrorResponse>";
        assert_eq!(extract_error_message(body), "boom happened");
    }

    #[test]
    fn member_param_formats_indexed_lists() {
        assert_eq!(member_param("AlarmNames", 1, ""), "AlarmNames.member.1");
        assert_eq!(
            member_param("Dimensions", 2, "Name"),
            "Dimensions.member.2.Name"
        );
    }

    #[test]
    fn metric_summary_serializes_camel_case() {
        let m = MetricSummary {
            namespace: "NS".into(),
            name: "M".into(),
            dimensions: vec![CwDimension {
                name: "d".into(),
                value: "v".into(),
            }],
        };
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["namespace"], "NS");
        assert_eq!(v["name"], "M");
        assert_eq!(v["dimensions"][0]["name"], "d");
    }

    #[test]
    fn alarm_summary_serializes_camel_case() {
        let a = AlarmSummary {
            name: "a".into(),
            state: "OK".into(),
            metric_name: Some("m".into()),
            namespace: Some("ns".into()),
            threshold: Some(1.5),
            comparison_operator: Some("GreaterThanThreshold".into()),
            statistic: Some("Average".into()),
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["name"], "a");
        assert_eq!(v["state"], "OK");
        assert_eq!(v["metricName"], "m");
        assert_eq!(v["comparisonOperator"], "GreaterThanThreshold");
    }

    #[test]
    fn put_alarm_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "name": "a", "namespace": "ns", "metricName": "m",
            "stat": "Average", "periodSec": 60, "threshold": 10.0,
            "comparison": "GreaterThanThreshold"
        });
        let req: PutMetricAlarmRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.name, "a");
        assert_eq!(req.metric_name, "m");
        assert_eq!(req.period_sec, 60);
        assert_eq!(req.threshold, 10.0);
    }

    #[test]
    fn stats_request_deserializes_camel_case_with_dimensions() {
        let json = serde_json::json!({
            "namespace": "ns", "metricName": "m",
            "dimensions": [{"name": "Host", "value": "h1"}],
            "periodSec": 300, "stat": "Sum",
            "startIso": "2026-07-22T00:00:00Z", "endIso": "2026-07-22T01:00:00Z"
        });
        let req: GetMetricStatisticsRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.metric_name, "m");
        assert_eq!(req.period_sec, 300);
        assert_eq!(req.stat, "Sum");
        assert_eq!(req.dimensions.len(), 1);
        assert_eq!(req.dimensions[0].name, "Host");
    }
}
