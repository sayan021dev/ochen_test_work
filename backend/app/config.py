from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.catalog import ROOT


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", extra="ignore", validate_assignment=True, hide_input_in_errors=True
    )
    openai_api_key: SecretStr = SecretStr("")
    http_proxy: SecretStr = SecretStr("")
    openai_model: str = "gpt-6-luna"
    database_url: str = (
        "postgresql+psycopg://illustrations:illustrations_local@127.0.0.1:54329/illustrations"
    )
    allowed_origins: list[str] = [
        "http://127.0.0.1:5178",
        "http://localhost:5178",
        "http://127.0.0.1:8017",
        "http://localhost:8017",
    ]
    ai_request_limit: int = Field(default=100, ge=1, le=10000)
    ai_session_limit: int = Field(default=20, ge=1, le=1000)
    custom_shadows_enabled: bool = True
    cookie_secure: bool = False
    site_password: SecretStr = SecretStr("")
    require_site_password: bool = False
    auth_secret: SecretStr = SecretStr("")

    @model_validator(mode="after")
    def validate_site_auth(self):
        if self.require_site_password and not self.site_password.get_secret_value():
            raise ValueError("SITE_PASSWORD is required when REQUIRE_SITE_PASSWORD=true")
        secret = self.auth_secret.get_secret_value()
        if secret and len(secret) < 32:
            raise ValueError("AUTH_SECRET must contain at least 32 characters")
        return self
