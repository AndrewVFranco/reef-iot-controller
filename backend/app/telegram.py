import logging
import aiohttp
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

TELEGRAM_API_URL = "https://api.telegram.org/bot{token}/sendMessage"

async def send_alert(message: str):
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.warning("Telegram not configured, skipping alert")
        return

    url = TELEGRAM_API_URL.format(token=settings.telegram_bot_token)
    payload = {
        "chat_id": settings.telegram_chat_id,
        "text": message,
        "parse_mode": "HTML"
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    logger.info("Telegram alert sent")
                else:
                    text = await response.text()
                    logger.error(f"Telegram API error {response.status}: {text}")
    except aiohttp.ClientError as e:
        logger.error(f"Telegram request failed: {e}")
    except Exception as e:
        logger.error(f"Telegram unexpected error: {e}")
