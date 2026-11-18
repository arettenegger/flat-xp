<?php
/**
 * Kontaktformular-Versand für die statische Flat-XP-Seite auf SiteGround.
 * Verschickt die Anfrage per PHP mail() an die unten stehende Adresse.
 */
$TO   = 'info@flat-xp.at';
$FROM = 'website@flat-xp.at';   // Absender muss eine Adresse der eigenen Domain sein

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: /kontakt/'); exit; }

// Spam-Schutz: verstecktes Feld muss leer sein
if (!empty($_POST['website'])) { header('Location: /kontakt/danke/'); exit; }

function field($k, $max) {
  $v = isset($_POST[$k]) ? trim((string)$_POST[$k]) : '';
  $v = str_replace(["\r", "\0"], '', $v);
  return mb_substr($v, 0, $max);
}
$name      = str_replace("\n", ' ', field('name', 100));
$email     = field('email', 150);
$telefon   = str_replace("\n", ' ', field('telefon', 50));
$betreff   = str_replace("\n", ' ', field('betreff', 150));
$nachricht = field('nachricht', 5000);

if ($name === '' || $nachricht === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || empty($_POST['dsgvo'])) {
  http_response_code(400);
  echo '<!doctype html><meta charset="utf-8"><p>Bitte Name, gültige E-Mail, Nachricht und Zustimmung angeben. <a href="javascript:history.back()">Zurück</a></p>';
  exit;
}

// einfache Drosselung: max. 1 Nachricht pro 30 s je IP
$lock = sys_get_temp_dir() . '/flatxp_' . md5($_SERVER['REMOTE_ADDR'] ?? '');
if (file_exists($lock) && time() - filemtime($lock) < 30) { header('Location: /kontakt/danke/'); exit; }
@touch($lock);

$subject = 'Anfrage über flat-xp.at' . ($betreff !== '' ? ': ' . $betreff : '');
$body = "Name: $name\nE-Mail: $email\nTelefon: $telefon\nBetreff: $betreff\n\n$nachricht\n";
$headers = [
  'From: Flat-XP Website <' . $FROM . '>',
  'Reply-To: ' . $email,
  'Content-Type: text/plain; charset=UTF-8',
];
$ok = mail($TO, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers));

if ($ok) { header('Location: /kontakt/danke/'); exit; }
http_response_code(500);
echo '<!doctype html><meta charset="utf-8"><p>Die Nachricht konnte leider nicht gesendet werden. Bitte schreiben Sie direkt an <a href="mailto:' . $TO . '">' . $TO . '</a>.</p>';
