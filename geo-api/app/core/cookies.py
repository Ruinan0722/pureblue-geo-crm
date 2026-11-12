from fastapi import Response

from app.config import get_settings


def access_token_cookie_options(max_age: int, *, secure: bool) -> dict:
    settings = get_settings()
    return {
        "key": settings.jwt_cookie,
        "httponly": True,
        "secure": secure,
        "samesite": "lax",
        "path": "/",
        "max_age": max_age,
    }


def oauth_state_cookie_options(max_age: int = 600, *, secure: bool) -> dict:
    return {
        "key": "feishu_oauth_state",
        "httponly": True,
        "secure": secure,
        "samesite": "lax",
        "path": "/",
        "max_age": max_age,
    }


def set_access_token_cookie(response: Response, access_token: str, max_age: int, *, secure: bool) -> None:
    opts = access_token_cookie_options(max_age, secure=secure)
    response.set_cookie(value=access_token, **opts)


def clear_access_token_cookie(response: Response, *, secure: bool) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.jwt_cookie,
        path="/",
        httponly=True,
        secure=secure,
        samesite="lax",
    )


def clear_oauth_state_cookie(response: Response, *, secure: bool) -> None:
    response.delete_cookie(
        key="feishu_oauth_state",
        path="/",
        httponly=True,
        secure=secure,
        samesite="lax",
    )
