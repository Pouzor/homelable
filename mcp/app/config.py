from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mcp_api_key: str = "mcp_sk_changeme"       # AI client → MCP server
    mcp_service_key: str = "svc_changeme"       # MCP server → backend
    backend_url: str = "http://backend:8000"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
