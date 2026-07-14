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
    E: aws_smithy_types::error::metadata::ProvideErrorMetadata + std::fmt::Debug,
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
                // SQS reports a missing queue as QueueDoesNotExist (AWS JSON
                // protocol) or AWS.SimpleQueueService.NonExistentQueue (query
                // protocol, used by some emulators).
                "ResourceNotFoundException"
                | "QueueDoesNotExist"
                | "AWS.SimpleQueueService.NonExistentQueue" => AppError::NotFound(msg),
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

    use aws_smithy_runtime_api::client::result::ConnectorError;
    use aws_smithy_runtime_api::http::{Response, StatusCode};
    use aws_smithy_types::body::SdkBody;
    use aws_smithy_types::error::ErrorMetadata;

    #[test]
    fn app_error_serializes_with_kind_and_message() {
        let e = AppError::Connection("refused".into());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "connection");
        assert_eq!(json["message"], "refused");
    }

    /// Build a `SdkError::ServiceError` carrying an `ErrorMetadata` with the given code/message.
    fn service_error(code: &str, message: &str) -> SdkError<ErrorMetadata, Response> {
        let meta = ErrorMetadata::builder().code(code).message(message).build();
        let raw = Response::new(StatusCode::try_from(400).unwrap(), SdkBody::empty());
        SdkError::service_error(meta, raw)
    }

    #[test]
    fn service_error_resource_not_found_maps_to_not_found() {
        let err = service_error("ResourceNotFoundException", "no such table");
        assert_eq!(map_sdk_err(err), AppError::NotFound("no such table".into()));
    }

    #[test]
    fn service_error_sqs_missing_queue_codes_map_to_not_found() {
        for code in [
            "QueueDoesNotExist",
            "AWS.SimpleQueueService.NonExistentQueue",
        ] {
            let err = service_error(code, "no such queue");
            assert_eq!(
                map_sdk_err(err),
                AppError::NotFound("no such queue".into()),
                "code {code} should map to NotFound"
            );
        }
    }

    #[test]
    fn service_error_validation_codes_map_to_validation() {
        for code in [
            "ValidationException",
            "ConditionalCheckFailedException",
            "ResourceInUseException",
        ] {
            let err = service_error(code, "bad request");
            assert_eq!(
                map_sdk_err(err),
                AppError::Validation("bad request".into()),
                "code {code} should map to Validation"
            );
        }
    }

    #[test]
    fn service_error_unlisted_code_maps_to_internal() {
        let err = service_error("InternalServerError", "boom");
        assert_eq!(
            map_sdk_err(err),
            AppError::Internal("InternalServerError: boom".into())
        );
    }

    #[test]
    fn timeout_error_maps_to_connection() {
        let err: SdkError<ErrorMetadata, Response> =
            SdkError::timeout_error(Box::<dyn std::error::Error + Send + Sync>::from(
                "timed out",
            ));
        assert!(matches!(map_sdk_err(err), AppError::Connection(_)));
    }

    #[test]
    fn dispatch_failure_maps_to_connection() {
        let err: SdkError<ErrorMetadata, Response> =
            SdkError::dispatch_failure(ConnectorError::user(Box::<
                dyn std::error::Error + Send + Sync,
            >::from("no route")));
        assert!(matches!(map_sdk_err(err), AppError::Connection(_)));
    }
}
