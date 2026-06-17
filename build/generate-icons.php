<?php
/**
 * generate-icons.php — produce the PWA icon set with GD.
 * Run once (or whenever the look changes):  php build/generate-icons.php
 * Output: public/assets/icons/{apple-touch-icon,icon-192,icon-512,icon-512-maskable}.png
 *
 * Pure build-time tooling — not needed at runtime on IONOS.
 */

$font = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
if (!is_file($font)) {
    // Fall back to any TTF we can find.
    foreach (glob('/usr/share/fonts/truetype/**/*.ttf') ?: [] as $f) { $font = $f; break; }
}
$outDir = __DIR__ . '/../public/assets/icons';
@mkdir($outDir, 0775, true);

function icon(string $path, int $size, string $font, bool $maskable): void
{
    $img = imagecreatetruecolor($size, $size);
    $bg    = imagecolorallocate($img, 10, 11, 13);    // #0a0b0d
    $tile  = imagecolorallocate($img, 28, 31, 36);    // #1c1f24
    $amber = imagecolorallocate($img, 245, 179, 1);   // #f5b301
    $line  = imagecolorallocate($img, 0, 0, 0);

    imagefilledrectangle($img, 0, 0, $size, $size, $bg);

    // A "flap tile" panel. For maskable icons keep art inside the safe zone.
    $pad = $maskable ? (int)($size * 0.18) : (int)($size * 0.08);
    imagefilledrectangle($img, $pad, $pad, $size - $pad, $size - $pad, $tile);
    // centre split line
    imagefilledrectangle($img, $pad, (int)($size / 2) - max(1, $size / 256),
        $size - $pad, (int)($size / 2) + max(1, $size / 256), $line);

    // "PHL" text in amber, centred.
    $text = 'KMH';
    $fs = $size * 0.30;
    $box = imagettfbbox($fs, 0, $font, $text);
    $tw = $box[2] - $box[0];
    $th = $box[1] - $box[7];
    $x = (int)(($size - $tw) / 2 - $box[0]);
    $y = (int)(($size + $th) / 2 - $box[1]);
    imagettftext($img, $fs, 0, $x, $y, $amber, $font, $text);

    imagepng($img, $path);
    imagedestroy($img);
    echo "wrote $path\n";
}

icon($outDir . '/apple-touch-icon.png', 180, $font, false);
icon($outDir . '/icon-192.png',         192, $font, false);
icon($outDir . '/icon-512.png',         512, $font, false);
icon($outDir . '/icon-512-maskable.png',512, $font, true);
echo "done\n";
