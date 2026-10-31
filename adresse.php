<?php
// Adresses du PC à taper dans le navigateur du casque (réseau local, https).
// On ne garde que les cartes qui ont une passerelle : les cartes virtuelles
// (VPN, machines virtuelles) n'en ont pas et ne sont pas joignables par le casque.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$out = [];
$raw = (string) shell_exec('ipconfig');
foreach (preg_split('/\r?\n(?=\S)/', $raw) as $block) {
    if (!preg_match_all('/IPv4[^:]*:\s*([\d.]+)/', $block, $ips)) continue;
    if (!preg_match('/(?:Passerelle|Gateway)[^:]*:\s*(?:[0-9a-f:%.]+\s+)*?(\d+\.\d+\.\d+\.\d+)/i', $block)) continue;
    $name = trim(strtok($block, "\r\n"), " :");
    foreach ($ips[1] as $ip) {
        if (preg_match('/^(127\.|169\.254\.)/', $ip)) continue;
        $out[] = ['ip' => $ip, 'url' => "https://$ip/", 'carte' => mb_convert_encoding($name, 'UTF-8', 'CP850')];
    }
}
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
