// Odesílání e-mailů přes Brevo (stejný účet jako objednávky).
export const sentMails = (globalThis.__basecampMails ??= []); // jen pro lokální testy

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function passwordMail({ name, username, link, kind }) {
  const welcome = kind === 'welcome';
  const subject = welcome ? 'ZaZa BaseCamp – nastav si heslo' : 'ZaZa BaseCamp – nové heslo';
  const intro = welcome
    ? 'byl ti založen účet v ZaZa BaseCampu, kde najdeš směrnice, receptury a návody.'
    : 'přišla žádost o nové heslo do ZaZa BaseCampu. Pokud jsi ji neposílal/a, e-mail klidně ignoruj.';
  const validity = welcome ? 'Odkaz platí 3 dny.' : 'Odkaz platí jen omezenou dobu a jde použít jednou.';
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1F2A28">
<div style="background:#0B4A44;padding:18px 24px;border-radius:12px 12px 0 0"><span style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:2px">ZAZA</span> <span style="color:#CFE3DF;font-size:11px;letter-spacing:3px">BASECAMP</span></div>
<div style="background:#F5F3EE;padding:24px;border-radius:0 0 12px 12px;font-size:15px;line-height:1.6">
<p>Ahoj ${esc(name)},</p><p>${intro}</p>
${username ? `<p>Tvoje uživatelské jméno pro přihlášení: <b>${esc(username)}</b><br><span style="font-size:13px;color:#5E5750">Přihlásit se jde i tímhle e-mailem.</span></p>` : ''}
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#0B4A44;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Nastavit heslo</a></p>
<p style="font-size:13px;color:#5E5750">${validity}<br>Pokud tlačítko nefunguje, zkopíruj do prohlížeče:<br>${esc(link)}</p>
<p>ZaZa Brno</p></div></div>`;
  return { subject, html };
}

export async function sendMail({ to, name, subject, html }) {
  if (process.env.BASECAMP_MEMORY_STORE === '1' || process.env.BASECAMP_CAPTURE_MAIL === '1') {
    sentMails.push({ to, name, subject, html });
    return true;
  }
  const key = process.env.BREVO_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!key || !sender) {
    console.error('Chybí BREVO_KEY nebo BREVO_SENDER_EMAIL');
    return false;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender, name: 'ZaZa BaseCamp' },
        to: [{ email: to, name }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) console.error('Brevo odmítl e-mail', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('Brevo nedostupné', e);
    return false;
  }
}
