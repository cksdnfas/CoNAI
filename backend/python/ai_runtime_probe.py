#!/usr/bin/env python3
"""Check a Python environment for the AI worker and print one JSON line.

Reports torch / CUDA state, whether every visible GPU has kernels in this torch build, runs a small matmul on the
GPU, and lists the versions of the libraries the worker imports. Never raises: failures land in "error".
"""
import importlib.metadata
import json
import platform
import sys

PACKAGES = (
    "torch",
    "torchvision",
    "timm",
    "transformers",
    "sentence-transformers",
    "safetensors",
    "huggingface-hub",
    "pillow",
    "numpy",
)


def package_versions():
    versions = {}
    for name in PACKAGES:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def gpu_in_arch_list(capability, arch_list):
    """A GPU runs when the build has its exact SASS (sm_XY) or PTX for an equal-or-lower arch (compute_XY)."""
    major, minor = capability
    value = major * 10 + minor
    for arch in arch_list:
        kind, _, number = arch.partition("_")
        if not number.isdigit():
            continue
        arch_value = int(number)
        if kind == "sm" and arch_value == value:
            return True
        if kind == "compute" and arch_value <= value:
            return True
    return False


def main():
    result = {
        "ok": False,
        "python": platform.python_version(),
        "torch": None,
        "torchCuda": None,
        "cudaAvailable": False,
        "devices": [],
        "archList": [],
        "gpuSupported": None,
        "gpuComputeOk": None,
        "packages": package_versions(),
        "error": None,
    }
    try:
        import torch

        result["torch"] = torch.__version__
        result["torchCuda"] = torch.version.cuda
        result["cudaAvailable"] = bool(torch.cuda.is_available())
        if result["cudaAvailable"]:
            arch_list = list(torch.cuda.get_arch_list())
            result["archList"] = arch_list
            supported = True
            for index in range(torch.cuda.device_count()):
                capability = torch.cuda.get_device_capability(index)
                result["devices"].append({
                    "name": torch.cuda.get_device_name(index),
                    "capability": f"{capability[0]}.{capability[1]}",
                })
                supported = supported and gpu_in_arch_list(capability, arch_list)
            result["gpuSupported"] = supported
            if supported:
                a = torch.randn(256, 256, device="cuda")
                b = (a @ a.T).sum().item()
                torch.cuda.synchronize()
                result["gpuComputeOk"] = b == b  # NaN check
            else:
                result["gpuComputeOk"] = False
        missing = [name for name, version in result["packages"].items() if version is None]
        if missing:
            result["error"] = "missing packages: " + ", ".join(missing)
        result["ok"] = not missing and result["gpuComputeOk"] is not False
    except Exception as exc:  # noqa: BLE001 - report, never crash
        result["error"] = f"{type(exc).__name__}: {exc}"
    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
