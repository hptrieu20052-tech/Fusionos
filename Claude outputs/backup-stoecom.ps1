# ============================================================================
#  backup-stoecom.ps1 - Tai toan bo file design he cu (S3 stoecombucket) ve may
#  Cach chay:  mo PowerShell -> cd vao thu muc chua 2 file nay ->
#     powershell -ExecutionPolicy Bypass -File .\backup-stoecom.ps1
#  Tuy chon:
#     -Dest D:\BACKUP-STOECOM   (thu muc dich, mac dinh nhu vay)
#     -Jobs 8                   (so luong tai song song)
#     -NoMockup                 (bo qua thu muc mockup/ ~174GB)
#     -NoThumbs                 (bo qua anh thumbnail _sm*)
#  CHAY LAI LA TU NOI TIEP: file nao da co (dung luong > 0) thi bo qua.
# ============================================================================
param(
  [string]$UrlFile = "$PSScriptRoot\legacy-backup-urls.txt",
  [string]$Dest = "D:\BACKUP-STOECOM",
  [int]$Jobs = 8,
  [switch]$NoMockup,
  [switch]$NoThumbs
)
$ErrorActionPreference = "Continue"
if (!(Test-Path $UrlFile)) { Write-Host "Khong thay $UrlFile (giai nen legacy-backup-urls.zip canh script)" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

Write-Host "Doc danh sach file..." -ForegroundColor Cyan
$rows = @(Get-Content $UrlFile | ForEach-Object {
  $p = $_ -split "`t"
  if ($p.Count -ge 2 -and $p[0] -like "https://*") { ,@($p[0], $p[1]) }
})
if ($NoMockup) { $rows = @($rows | Where-Object { $_[1] -notlike "mockup/*" }) }
if ($NoThumbs) { $rows = @($rows | Where-Object { $_[1] -notmatch "_sm[0-9]*\.(png|jpe?g|webp)$" }) }
$total = $rows.Count
Write-Host "$total file can tai -> $Dest" -ForegroundColor Cyan

# Chia danh sach ra FILE tam cho tung job (truyen duong dan, khong serialize 400K dong qua job)
$prog = Join-Path $env:TEMP "bkstoecom"
New-Item -ItemType Directory -Force -Path $prog | Out-Null
Get-ChildItem $prog -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
$writers = @{}
for ($i = 0; $i -lt $Jobs; $i++) { $writers[$i] = New-Object System.IO.StreamWriter((Join-Path $prog "j$i.lst"), $false, [Text.Encoding]::UTF8) }
for ($k = 0; $k -lt $total; $k++) { $writers[$k % $Jobs].WriteLine($rows[$k][0] + "`t" + $rows[$k][1]) }
$writers.Values | ForEach-Object { $_.Close() }

$work = {
  param($listFile, $dest, $cntFile)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $done = 0; $fail = 0
  $wc = New-Object System.Net.WebClient
  foreach ($line in [System.IO.File]::ReadLines($listFile)) {
    $r = $line -split "`t"
    if ($r.Count -lt 2) { continue }
    $url = $r[0]
    $rel = ($r[1] -replace '\?.*$','') -replace '[<>:"|?*]', '_'
    $out = Join-Path $dest $rel
    $dir = Split-Path $out -Parent
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $ok = (Test-Path $out) -and ((Get-Item $out).Length -gt 0)
    if (-not $ok) {
      for ($t = 1; $t -le 3 -and -not $ok; $t++) {
        try { $wc.DownloadFile($url, "$out.part"); Move-Item -Force "$out.part" $out; $ok = $true }
        catch { Start-Sleep -Seconds (3 * $t); Remove-Item -Force "$out.part" -ErrorAction SilentlyContinue }
      }
      if (-not $ok) { $fail++; Add-Content -Path "$cntFile.err" -Value $url }
    }
    $done++
    if ($done % 25 -eq 0) { Set-Content -Path $cntFile -Value "$done $fail" }
  }
  Set-Content -Path $cntFile -Value "$done $fail"
}

$jobObjs = @()
for ($i = 0; $i -lt $Jobs; $i++) {
  $jobObjs += Start-Job -ScriptBlock $work -ArgumentList @((Join-Path $prog "j$i.lst"), $Dest, (Join-Path $prog "j$i.cnt"))
}
Write-Host "Da chay $Jobs luong tai. De may chay (sleep OFF). Ctrl+C dung - chay lai script la noi tiep." -ForegroundColor Yellow

while ($true) {
  Start-Sleep -Seconds 20
  $d = 0; $f = 0
  Get-ChildItem $prog -Filter "*.cnt" -ErrorAction SilentlyContinue | ForEach-Object {
    $v = (Get-Content $_.FullName -ErrorAction SilentlyContinue) -split " "
    if ($v.Count -ge 2) { $d += [int]$v[0]; $f += [int]$v[1] }
  }
  $pct = if ($total) { [math]::Round(100 * $d / $total, 1) } else { 0 }
  Write-Host ("{0:HH:mm:ss}  {1}/{2} ({3}%)  loi: {4}" -f (Get-Date), $d, $total, $pct, $f)
  if (@($jobObjs | Where-Object { $_.State -eq "Running" }).Count -eq 0) { break }
}
$jobObjs | Receive-Job -ErrorAction SilentlyContinue | Out-Null
$jobObjs | Remove-Job -Force
$errs = Get-ChildItem $prog -Filter "*.cnt.err" -ErrorAction SilentlyContinue
if ($errs) {
  $all = $errs | Get-Content
  Write-Host "XONG - $($all.Count) file loi (danh sach: $prog\*.err). Chay lai script de thu lai." -ForegroundColor Yellow
} else { Write-Host "XONG - khong co file loi." -ForegroundColor Green }
