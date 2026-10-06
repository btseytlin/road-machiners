import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "files" / "check-ports.sh"


def check(lines: str) -> subprocess.CompletedProcess:
    listing = Path(__file__).parent.parent.parent.parent / "tmp" / "check-ports-listing.txt"
    listing.parent.mkdir(parents=True, exist_ok=True)
    listing.write_text(lines)
    return subprocess.run(["bash", str(SCRIPT), str(listing)], text=True, capture_output=True)


def test_exposed_ports_without_mapping_pass():
    result = check("factory-caddy\t80/tcp, 443/tcp, 2019/tcp\nfactory-tunnel\t\nfactory-hermes\t\n")
    assert result.returncode == 0, result.stdout


def test_any_published_port_fails():
    result = check("factory-hermes\t0.0.0.0:8642->8642/tcp\n")
    assert result.returncode == 1
    assert "factory-hermes" in result.stdout


def test_published_caddy_port_fails():
    result = check("factory-caddy\t0.0.0.0:80->80/tcp\n")
    assert result.returncode == 1
    assert "factory-caddy" in result.stdout
