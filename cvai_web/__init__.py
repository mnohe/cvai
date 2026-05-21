def create_app():
    from .asgi import create_fastapi_app

    return create_fastapi_app()


def main() -> None:
    from .asgi import main as asgi_main

    asgi_main()

__all__ = ["create_app", "main"]
