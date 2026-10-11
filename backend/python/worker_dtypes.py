"""Weight precision shared by the image models: half the memory wherever it costs no accuracy or speed."""
import torch


def cpu_native_bf16() -> bool:
    """AVX512-BF16 / AMX. Older CPUs (e.g. NAS boxes) emulate BF16 and run several times slower than FP32."""
    return any(getattr(torch.cpu, check, lambda: False)() for check in ("_is_avx512_bf16_supported", "_is_amx_tile_supported"))


def half_dtype(device: torch.device, cuda_dtype: torch.dtype) -> torch.dtype:
    """`cuda_dtype` on CUDA, BF16 on CPUs with native BF16, FP32 elsewhere."""
    if device.type == "cuda":
        return cuda_dtype
    return torch.bfloat16 if cpu_native_bf16() else torch.float32
