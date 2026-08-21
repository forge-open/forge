from deploy.colab.hardware_check import get_hardware_info, print_hardware_report


def test_hardware_check():
    info = get_hardware_info()
    assert "gpu" in info
    assert "vram_gb" in info
    assert "cuda_version" in info
    assert "system_ram_gb" in info
    assert "available_disk_gb" in info

def test_hardware_report_output():
    info = print_hardware_report()
    assert isinstance(info, dict)
