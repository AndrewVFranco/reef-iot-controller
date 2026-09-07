from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # MQTT
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = ""

    # InfluxDB
    influx_host: str = "localhost"
    influx_port: int = 8086
    influx_database: str = "reef_db"
    influx_username: str = "reef"
    influx_password: str = ""

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # App
    static_files_path: str = "static"
    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
