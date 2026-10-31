<?php
// Collection de projets commune à tous les navigateurs servis par ce PC :
// http://localhost/VRpaint/ (souris, Link) et https://<IP du PC>/ (navigateur du casque).
// Un projet = un fichier projets/<id>.vrpaint (format décrit dans js/projectfile.js) ;
// son en-tête porte le nom, la date, le mur, les couleurs perso et la vignette.
//   GET  projets.php?liste                 projets (en-têtes seulement, JSON ; ETag)
//   GET  projets.php?id=<id>               le fichier du projet
//   PUT  projets.php?base=<date>           enregistrement (corps = fichier) ; base = date de la version
//                                          sur laquelle l'appareil a travaillé, vide pour un projet neuf.
//                                          409 si le projet a changé entre-temps (enregistré ailleurs)
//   POST projets.php?renommer=<id>         corps = nouveau nom
//   POST projets.php?supprimer=<id>
// &projets=<nom> : collection à part (tests automatiques), &vider la supprime.
header('Cache-Control: no-cache');

const MAX_SIZE = 400 * 1024 * 1024;
const MAGIC = 'VRPAINT1';

function reply(int $code, $data): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function validId(string $id): bool {
    return (bool) preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id);
}

// En-tête d'un fichier .vrpaint : [en-tête décodé, longueur de l'en-tête] ou null
function readHeader(string $file): ?array {
    $fh = @fopen($file, 'rb');
    if (!$fh) return null;
    $head = fread($fh, 12);
    $len = strlen($head) === 12 && substr($head, 0, 8) === MAGIC ? unpack('V', substr($head, 8))[1] : 0;
    $json = $len > 0 && $len < 64 << 20 ? fread($fh, $len) : '';
    fclose($fh);
    $h = json_decode($json, true);
    return is_array($h) && ($h['format'] ?? '') === 'vrpaint' && is_array($h['meta'] ?? null) ? [$h, $len] : null;
}

$collection = (string) ($_GET['projets'] ?? '');
if ($collection !== '' && !preg_match('/^[a-z0-9-]{1,40}$/', $collection)) reply(400, ['erreur' => 'collection invalide']);
$dir = __DIR__ . '/projets' . ($collection !== '' ? "/essais/$collection" : '');
if (!is_dir($dir) && !mkdir($dir, 0775, true)) reply(500, ['erreur' => 'dossier projets/ impossible à créer']);

// écritures une à une
$lock = fopen("$dir/.verrou", 'c');
$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') flock($lock, LOCK_EX);

if ($method === 'GET' && isset($_GET['liste'])) {
    $files = glob("$dir/*.vrpaint");
    $etag = '"' . md5(implode('|', array_map(fn($f) => basename($f) . filemtime($f) . filesize($f), $files))) . '"';
    header("ETag: $etag");
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
    $out = [];
    foreach ($files as $f) {
        $h = readHeader($f);
        if ($h && ($h[0]['meta']['id'] ?? '') === basename($f, '.vrpaint')) $out[] = $h[0]['meta'];
    }
    reply(200, $out);
}

if ($method === 'GET' && isset($_GET['id'])) {
    $id = (string) $_GET['id'];
    $file = "$dir/$id.vrpaint";
    if (!validId($id) || !is_file($file)) reply(404, ['erreur' => 'projet introuvable']);
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . filesize($file));
    readfile($file);
    exit;
}

if ($method === 'PUT') {
    $tmp = tempnam($dir, 'enr');
    $in = fopen('php://input', 'rb');
    $out = fopen($tmp, 'wb');
    $size = 0;
    while (!feof($in)) {
        $buf = fread($in, 1 << 20);
        if ($buf === false || $buf === '') break;
        $size += strlen($buf);
        if ($size > MAX_SIZE) { fclose($out); unlink($tmp); reply(413, ['erreur' => 'projet trop gros']); }
        fwrite($out, $buf);
    }
    fclose($in);
    fclose($out);
    $h = readHeader($tmp);
    $id = (string) ($h[0]['meta']['id'] ?? '');
    if (!$h || !validId($id)) { unlink($tmp); reply(400, ['erreur' => 'ce n\'est pas un projet VRpaint']); }
    $file = "$dir/$id.vrpaint";
    if (is_file($file)) {
        $cur = readHeader($file);
        $curDate = (string) ($cur[0]['meta']['date'] ?? '');
        if ((string) ($_GET['base'] ?? '') !== $curDate) {
            unlink($tmp);
            reply(409, ['erreur' => 'projet modifié sur un autre appareil', 'date' => $cur[0]['meta']['date'] ?? null]);
        }
    }
    if (!rename($tmp, $file)) { @unlink($tmp); reply(500, ['erreur' => 'écriture impossible']); }
    reply(200, $h[0]['meta']);
}

if ($method === 'POST' && isset($_GET['renommer'])) {
    $id = (string) $_GET['renommer'];
    $file = "$dir/$id.vrpaint";
    $name = trim(mb_substr((string) file_get_contents('php://input'), 0, 60));
    if (!validId($id) || !is_file($file) || $name === '') reply(400, ['erreur' => 'renommage impossible']);
    [$h, $len] = readHeader($file) ?? [null, 0];
    if (!$h) reply(500, ['erreur' => 'projet illisible']);
    $h['meta']['name'] = $name;
    // nouvel en-tête, puis les blocs recopiés tels quels (leurs positions sont relatives à la fin de l'en-tête)
    $json = json_encode($h, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = tempnam($dir, 'ren');
    $out = fopen($tmp, 'wb');
    fwrite($out, MAGIC . pack('V', strlen($json)) . $json);
    $in = fopen($file, 'rb');
    fseek($in, 12 + $len);
    stream_copy_to_stream($in, $out);
    fclose($in);
    fclose($out);
    if (!rename($tmp, $file)) { @unlink($tmp); reply(500, ['erreur' => 'écriture impossible']); }
    reply(200, $h['meta']);
}

if ($method === 'POST' && isset($_GET['supprimer'])) {
    $id = (string) $_GET['supprimer'];
    if (!validId($id)) reply(400, ['erreur' => 'identifiant invalide']);
    @unlink("$dir/$id.vrpaint");
    reply(200, ['ok' => true]);
}

if ($method === 'POST' && isset($_GET['vider']) && $collection !== '') {
    flock($lock, LOCK_UN);
    fclose($lock);
    array_map('unlink', glob("$dir/{*,.verrou}", GLOB_BRACE));
    @rmdir($dir);
    reply(200, ['ok' => true]);
}

reply(400, ['erreur' => 'requête inconnue']);
