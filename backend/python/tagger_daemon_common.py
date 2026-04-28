import json
import sys
from pathlib import Path
from typing import Any


def success_response(**fields: Any) -> dict[str, Any]:
    response: dict[str, Any] = {"success": True}
    response.update(fields)
    return response


def error_response(error: BaseException | str, error_type: str | None = None) -> dict[str, Any]:
    if isinstance(error, BaseException):
        return {
            "success": False,
            "error": str(error),
            "error_type": type(error).__name__,
        }

    return {
        "success": False,
        "error": error,
        "error_type": error_type or "Error",
    }


def validate_image_path(image_path: str) -> Path:
    image_path_obj = Path(image_path).resolve()
    if not image_path_obj.is_file():
        raise FileNotFoundError(f"Image file not found: {image_path}")
    return image_path_obj


def send_response(response: dict[str, Any]) -> None:
    print(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()
