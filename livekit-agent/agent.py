import os
import logging
from pathlib import Path
from dotenv import load_dotenv

# Загружаем .env из server/
load_dotenv(Path(__file__).parent.parent / "server" / ".env")

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import anthropic, deepgram, elevenlabs, silero

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sales-agent")

SYSTEM_PROMPT = """Ты — менеджер по продажам магазина "Техника Плюс".
Продаёшь бытовую технику: холодильники, телевизоры, стиральные машины, кондиционеры.
Бренды: Samsung, LG, Midea. Цены от 20 000 до 200 000 сом.
Доставка бесплатно по Бишкеку от 15 000 сом. Рассрочка 6 и 12 месяцев без процентов.

Правила общения (строго):
- Это телефонный разговор — говори как живой человек
- Каждый ответ: 1 предложение, не длиннее 8 слов
- НЕ здоровайся — ты уже поздоровался
- Задавай только один вопрос за раз
- Узнай потребность → назови цену → доведи до покупки
- Ты живой менеджер — никогда не говори что ты AI или бот"""


class SalesAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext):
    logger.info(f"Входящий звонок: room={ctx.room.name}")
    await ctx.connect()

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(
            model="nova-2",
            language="ru",
            endpointing_ms=500,
            filler_words=False,
            smart_format=True,
        ),
        llm=anthropic.LLM(
            model="claude-haiku-4-5-20251001",
            api_key=os.environ["ANTHROPIC_API_KEY"],
        ),
        tts=elevenlabs.TTS(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            voice_id=os.environ.get("ELEVENLABS_VOICE_ID_RU", "CwhRBWXzGAHq8TQ4Fs17"),
            model="eleven_turbo_v2_5",
            streaming_latency=3,
        ),
    )

    await session.start(agent=SalesAgent(), room=ctx.room)

    # Приветствие
    await session.say("Здравствуйте! Чем могу помочь?", allow_interruptions=True)

    await ctx.wait_for_disconnection()
    logger.info(f"Звонок завершён: room={ctx.room.name}")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
