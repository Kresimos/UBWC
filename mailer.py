"""Fault notifications by email. Best-effort: never blocks or fails a report.

Runs as a FastAPI background task after the response has gone out, so a slow
or dead SMTP server cannot slow down or fail the fault report itself. With no
SMTP credentials in the environment (local dev, tests, a deploy before the
club has set up an app password) sending is a logged no-op.

Gmail note for whoever configures this: the club account needs 2FA turned on
before Google will issue an app password, and that credential has to survive
committee handover — see misc/hosting.md.
"""
import logging
import os
import smtplib
from email.message import EmailMessage

import db

log = logging.getLogger("ubwc.mailer")


def fault_reported(item_id: int, title: str, description: str,
                   severity: str, author: str = None) -> None:
    """Mail the club inbox about a newly reported fault. Never raises."""
    host = os.environ.get("UBWC_SMTP_HOST")
    user = os.environ.get("UBWC_SMTP_USER")
    password = os.environ.get("UBWC_SMTP_PASS")
    if not (host and user and password):
        log.info("Mail not configured (UBWC_SMTP_*); skipping fault email for item %s.",
                 item_id)
        return
    try:
        item = db.get_item(item_id) or {}
        name = " ".join(filter(None, [item.get("manufacturer"), item.get("model")])) \
            or f"item {item_id}"
        subject = f"[UBWC Kit] Fault reported: {name}"
        if severity == "out_of_action":
            subject += " (out of action)"

        where = " / ".join(filter(None, [item.get("location"), item.get("spot")]))
        lines = [
            f"Fault: {title}",
            f"Severity: {severity}",
            f"Reported by: {author or 'unknown'}",
            f"Kit: {name}",
        ]
        if where:
            lines.append(f"Stored at: {where}")
        if description and description != title:
            lines.append("")
            lines.append(description)
        base_url = os.environ.get("UBWC_BASE_URL")
        if base_url:
            # The front end routes on the hash (web/js/router.js).
            lines.append("")
            lines.append(f"{base_url.rstrip('/')}/#/item/{item_id}")

        msg = EmailMessage()
        msg["Subject"] = subject
        # The SMTP login is not always a sendable address (Brevo's is an
        # @smtp-brevo.com identifier, which Gmail treats as spam). From must
        # be the provider-verified sender.
        msg["From"] = os.environ.get("UBWC_MAIL_FROM", user)
        msg["To"] = os.environ.get("UBWC_FAULT_EMAIL", "uob.windsurfing@gmail.com")
        msg.set_content("\n".join(lines))

        # 465 is implicit TLS; anything else (Brevo's 587, 2525) is STARTTLS.
        port = int(os.environ.get("UBWC_SMTP_PORT", "587"))
        if port == 465:
            smtp = smtplib.SMTP_SSL(host, port, timeout=20)
        else:
            smtp = smtplib.SMTP(host, port, timeout=20)
            smtp.starttls()
        with smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    except Exception:
        # A lost notification must never lose a fault report.
        log.exception("Failed to send fault email for item %s.", item_id)
