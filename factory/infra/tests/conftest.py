import os

# The package builds its settings on import. These dummies let tests import the pure helpers.
for key in ("FACTORY_HOST", "FACTORY_DOMAIN", "FACTORY_TUNNEL_TOKEN", "FACTORY_ENV_FILE", "FACTORY_GH_TOKEN"):
    os.environ.setdefault(key, "test")
