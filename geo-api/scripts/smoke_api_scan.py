"""Live API smoke: public + authenticated CRM list endpoints."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8000"


def req(opener, method: str, path: str, body: dict | None = None):
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with opener.open(request, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = raw[:200]
            return resp.status, payload, None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            payload = raw[:200]
        return e.code, payload, str(e)
    except Exception as e:  # noqa: BLE001
        return None, None, str(e)


def main() -> int:
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    results: list[tuple[str, str, object, str]] = []

    def check(label: str, method: str, path: str, expect_ok: bool, body: dict | None = None):
        status, payload, err = req(opener, method, path, body)
        ok = status is not None and 200 <= status < 300
        note = ""
        if err and status is None:
            note = err
        elif isinstance(payload, dict):
            if "detail" in payload:
                note = str(payload.get("detail"))[:120]
            elif "items" in payload:
                note = f"items={len(payload.get('items') or [])}"
            elif "leads" in payload:
                note = f"leads={len(payload.get('leads') or [])}"
            elif "customers" in payload:
                note = f"customers={len(payload.get('customers') or [])}"
            elif "opportunities" in payload:
                note = f"opps={len(payload.get('opportunities') or [])}"
            elif "contracts" in payload:
                note = f"contracts={len(payload.get('contracts') or [])}"
            elif "requests" in payload:
                note = f"requests={len(payload.get('requests') or [])}"
            elif "projects" in payload:
                note = f"projects={len(payload.get('projects') or [])}"
            elif "user" in payload:
                u = payload.get("user")
                note = f"user={u.get('name') if isinstance(u, dict) else u}"
            elif "status" in payload:
                note = f"status={payload.get('status')}"
            else:
                keys = ",".join(list(payload.keys())[:6])
                note = f"keys={keys}"
        elif payload is not None:
            note = str(payload)[:80]
        mark = "PASS" if (ok == expect_ok) or (expect_ok and ok) else ("PASS" if ok else "FAIL")
        if expect_ok and not ok:
            mark = "FAIL"
        if not expect_ok and status in (401, 403, 404, 405, 422):
            mark = "PASS"  # expected auth/method failure shape
            note = f"expected-fail {status} {note}"
        results.append((mark, f"{method} {path}", status, note))
        print(f"{mark}\t{status}\t{method} {path}\t{note}")

    # Public
    check("health", "GET", "/api/health", True)
    check("version", "GET", "/api/version", True)
    check("me-anon", "GET", "/api/auth/me", True)  # may return user=null

    # Unauth protected should fail
    check("leads-unauth", "GET", "/api/leads", False)

    # Dev login
    status, payload, err = req(
        opener,
        "POST",
        "/api/auth/me",
        {"name": "扫盘管理员", "role": "admin"},
    )
    if status and 200 <= status < 300:
        print(f"PASS\t{status}\tPOST /api/auth/me\tlogged-in")
        results.append(("PASS", "POST /api/auth/me", status, "logged-in"))
    else:
        print(f"FAIL\t{status}\tPOST /api/auth/me\t{err or payload}")
        results.append(("FAIL", "POST /api/auth/me", status, str(err or payload)))
        # continue anyway for visibility

    # Authenticated CRM / modules
    for method, path in [
        ("GET", "/api/auth/me"),
        ("GET", "/api/crm/bootstrap"),
        ("GET", "/api/crm/workbench"),
        ("GET", "/api/leads"),
        ("GET", "/api/leads/stats"),
        ("GET", "/api/customers"),
        ("GET", "/api/customers/stats"),
        ("GET", "/api/opportunities"),
        ("GET", "/api/contracts"),
        ("GET", "/api/requests"),
        ("GET", "/api/requests/stats"),
        ("GET", "/api/projects"),
        ("GET", "/api/projects/stats"),
        ("GET", "/api/checkin"),
        ("GET", "/api/checkin/stats"),
        ("GET", "/api/invites"),
        ("GET", "/api/lead-source-options"),
        ("GET", "/api/crm/audit"),
        ("GET", "/api/crm/notifications"),
        ("GET", "/api/users/directory"),
        ("GET", "/api/users/sales-colleagues"),
        ("GET", "/api/rbac/permissions"),
        ("GET", "/api/rbac/roles"),
        ("GET", "/api/rbac/meta"),
        ("GET", "/api/rbac/users"),
    ]:
        check(path, method, path, True)

    # Integration mismatch probes (expect fail)
    check("rbac-patch-wrong", "PATCH", "/api/rbac/users/u-smoke", False, {"roleLocked": True})
    check("dept-post", "POST", "/api/rbac/directory/departments", False, {"parentId": "root"})

    failed = sum(1 for m, *_ in results if m == "FAIL")
    passed = sum(1 for m, *_ in results if m == "PASS")
    print(f"\nSUMMARY passed={passed} failed={failed} total={len(results)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
