# ════════════════════════════════════════════════════════════════════════════
# download-designs.ps1 — tải toàn bộ file design của 1 seller từ FUSION về máy.
#
# Bước 1: trên browser (đăng nhập ADMIN) mở:
#   https://os.fusiondn.com/api/designs/export-links?seller=Quang Trường
#   (đổi tên seller; thêm &by=designer nếu muốn lọc theo designer thay vì seller)
#   → trình duyệt tải về file designs-<seller>-<ngày>.csv
#
# Bước 2: mở PowerShell tại thư mục chứa file CSV, chạy:
#   powershell -ExecutionPolicy Bypass -File .\download-designs.ps1 -Csv ".\designs-Quang-Truong-2026-10-13.csv"
#
# File tải về: .\designs\<SKU>-<tên design>\<kind>-<filename>
# Chạy lại script = tải tiếp phần còn thiếu (file đã có thì bỏ qua).
# ════════════════════════════════════════════════════════════════════════════
param(
  [Parameter(Mandatory = $true)][string]$Csv,
  [string]$Out = "designs"
)

if (-not (Test-Path $Csv)) { Write-Error "Khong thay file CSV: $Csv"; exit 1 }
$rows = Import-Csv -Path $Csv
if (-not $rows -or $rows.Count -eq 0) { Write-Error "CSV rong — seller nay chua co design nao?"; exit 1 }

$ok = 0; $skip = 0; $fail = 0; $i = 0
foreach ($r in $rows) {
  $i++
  # Thư mục theo design: <SKU>-<title đã làm sạch ký tự cấm của Windows>
  $san = ($r.title -replace '[\\/:*?"<>|]', ' ') -replace '\s+', ' '
  $san = $san.Trim()
  if ($san.Length -gt 60) { $san = $san.Substring(0, 60).Trim() }
  $dir = Join-Path $Out ("{0}-{1}" -f $r.sku, $san)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  # Tên file: <kind>-<filename gốc> (không có filename thì lấy đuôi URL)
  $name = if ($r.filename) { $r.filename } else { ([uri]$r.url).Segments[-1] }
  $name = ("{0}-{1}" -f $r.kind, $name) -replace '[\\/:*?"<>|]', '_'
  $dest = Join-Path $dir $name

  if (Test-Path $dest) { $skip++; Write-Host ("[{0}/{1}] bo qua (da co): {2}" -f $i, $rows.Count, $dest) -ForegroundColor DarkGray; continue }
  Write-Host ("[{0}/{1}] {2} ({3} MB)" -f $i, $rows.Count, $dest, $r.size_mb)
  try {
    Invoke-WebRequest -Uri $r.url -OutFile $dest -UseBasicParsing
    $ok++
  } catch {
    $fail++
    Write-Warning ("LOI: {0} - {1}" -f $r.url, $_.Exception.Message)
    if (Test-Path $dest) { Remove-Item $dest -Force } # xoá file tải dở
  }
}
Write-Host ""
Write-Host ("XONG: {0} tai moi - {1} da co san - {2} loi. Thu muc: {3}" -f $ok, $skip, $fail, (Resolve-Path $Out)) -ForegroundColor Green
if ($fail -gt 0) { Write-Host "Chay lai script de tai lai cac file loi." -ForegroundColor Yellow }
