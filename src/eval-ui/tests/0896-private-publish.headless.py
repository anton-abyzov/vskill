"""Run against 0896-server.mjs. No real GitHub, publishing or billing writes."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

os.environ["PWDEBUG"] = "0"
os.environ["PLAYWRIGHT_HTML_OPEN"] = "never"
out = Path(os.environ.get("PRIVATE_PUBLISH_TEST_OUTPUT", "/tmp/0896-studio-headless"))
out.mkdir(parents=True, exist_ok=True)
base = f"http://127.0.0.1:{os.environ.get('PRIVATE_PUBLISH_TEST_PORT', '4186')}"
tenants = [
    {"tenantId": "tenant-1", "slug": "personal", "name": "Personal skills", "role": "owner", "installationId": "42"},
    {"tenantId": "tenant-2", "slug": "team", "name": "Team skills", "role": "admin", "installationId": "43"},
]
calls, errors = [], []
state = {"tenants": tenants, "active": "personal", "status_reads": 0, "dirty": False}

def api(route):
    path = route.request.url.split(base)[-1].split("?")[0]
    body = route.request.post_data_json if route.request.post_data else None
    calls.append({"path": path, "method": route.request.method, "body": body})
    payload = {}
    if path == "/api/v1/billing/quota":
        payload = {"tier": "pro", "skillCount": 1, "skillLimit": None, "gracePeriodDaysRemaining": 7}
    elif path == "/api/project/github-status":
        payload = {"hasGit": True, "githubOrigin": "https://github.com/acme/private-skills", "status": "github"}
    elif path == "/api/v1/account/tenants":
        payload = {"tenants": state["tenants"]}
    elif path == "/__internal/active-tenant":
        if body: state["active"] = body["currentTenant"]
        payload = {"currentTenant": state["active"]}
    elif path == "/api/git/diff":
        payload = {"hasChanges": state["dirty"], "fileCount": 1 if state["dirty"] else 0, "diff": ""}
    elif path == "/api/git/publish":
        payload = {"success": True, "remoteUrl": "https://github.com/acme/private-skills", "commitSha": "1234567890", "branch": "main"}
    elif path == "/api/v1/submissions":
        assert body["privacy"] == "private" and body["tenantId"] == "tenant-2", body
        payload = {"id": "psub_0896", "state": "RECEIVED", "privacy": "PRIVATE", "tenantId": body["tenantId"]}
    elif path == "/api/v1/submissions/psub_0896":
        state["status_reads"] += 1
        payload = {"id": "psub_0896", "state": "PUBLISHED", "privacy": "PRIVATE", "tenantId": "tenant-2"}
    elif path == "/api/config":
        payload = {"provider": "claude-cli", "model": "default"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="dark")
    context.route("**/api/**", api)
    context.route("**/__internal/**", api)
    # This harness must never need external URLs, personal sessions or credentials.
    context.route("https://**", lambda route: route.abort())
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base + "/tests/0896-publish.html?gate=open")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_test_id("tier")).to_have_text("pro")
    page.get_by_role("button", name="Publish", exact=True).click()
    page.get_by_test_id("publish-privacy-private").click()
    expect(page.get_by_role("combobox", name="Publishing account")).to_have_value("tenant-1")
    page.get_by_role("combobox", name="Publishing account").select_option("tenant-2")
    expect(page.get_by_role("button", name="Push & Submit", exact=True)).to_be_enabled()
    page.screenshot(path=str(out / "private-account-desktop.png"), full_page=True)
    page.get_by_role("button", name="Push & Submit", exact=True).click()
    expect(page.get_by_test_id("private-submission-status")).to_have_attribute("data-state", "PUBLISHED")
    expect(page.get_by_test_id("publish-open-website")).to_have_count(0)
    page.screenshot(path=str(out / "published-private-desktop.png"), full_page=True)
    assert state["status_reads"] == 1
    assert not any("/stream" in call["path"] for call in calls)

    state["tenants"] = []
    page.set_viewport_size({"width": 390, "height": 844})
    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Publish", exact=True).click()
    page.get_by_test_id("publish-privacy-private").click()
    expect(page.get_by_role("button", name="Push & Submit", exact=True)).to_be_disabled()
    expect(page.get_by_role("button", name="Connect GitHub App", exact=False)).to_be_visible()
    expect(page.get_by_text("Sign in to submit", exact=False)).to_have_count(0)
    page.screenshot(path=str(out / "missing-account-mobile.png"), full_page=True)

    state["dirty"] = True
    page.goto(base + "/tests/0896-publish.html")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Publish", exact=True).click()
    expect(page.get_by_test_id("publish-privacy-unavailable")).to_be_visible()
    expect(page.get_by_test_id("publish-privacy-private")).to_have_count(0)
    page.screenshot(path=str(out / "closed-gate-mobile.png"), full_page=True)
    assert not errors, errors
    (out / "verification.json").write_text(json.dumps({"headless": True, "passed": True, "calls": calls, "pageErrors": errors}, indent=2))
    browser.close()
print(json.dumps({"passed": True, "output": str(out), "screenshots": 4}))
