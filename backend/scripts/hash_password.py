"""Generate a bcrypt password hash for the AUTH_PASSWORD_HASH env var."""
import sys

import bcrypt

if len(sys.argv) < 2:
    print("Usage: python scripts/hash_password.py <password>")
    sys.exit(1)

password = sys.argv[1]
print(bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))
