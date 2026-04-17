# Apply APPLY_NOW.sql statement-by-statement via Supabase Management API.
# Splits on ";" respecting $$ ... $$ dollar-quoted blocks.

param(
    [string]$Pat = $env:SUPABASE_PAT,
    [string]$Ref = 'eclrkusmwcrtnxqhzpky',
    [string]$File = 'supabase/migrations/APPLY_NOW.sql'
)

if (-not $Pat) { throw 'SUPABASE_PAT not set' }

$sql = Get-Content -Raw $File
# Strip standalone comment lines (keep trailing comments)
$lines = $sql -split "`r?`n"

function Split-SqlStatements($text) {
    $statements = @()
    $buf = New-Object System.Text.StringBuilder
    $i = 0
    $inDollar = $false
    while ($i -lt $text.Length) {
        $c = $text[$i]
        # detect $$ pair
        if ($c -eq '$' -and ($i + 1) -lt $text.Length -and $text[$i + 1] -eq '$') {
            [void]$buf.Append('$$')
            $inDollar = -not $inDollar
            $i += 2
            continue
        }
        # also accept $sql$ ... $sql$ custom tags (we use $sql$ in 012)
        if ($c -eq '$' -and -not $inDollar) {
            $m = [regex]::Match($text.Substring($i), '^\$[a-zA-Z_][a-zA-Z0-9_]*\$')
            if ($m.Success) {
                [void]$buf.Append($m.Value)
                $inDollar = $true
                $i += $m.Length
                continue
            }
        } elseif ($c -eq '$' -and $inDollar) {
            $m = [regex]::Match($text.Substring($i), '^\$[a-zA-Z_][a-zA-Z0-9_]*\$')
            if ($m.Success) {
                [void]$buf.Append($m.Value)
                $inDollar = $false
                $i += $m.Length
                continue
            }
        }
        if ($c -eq ';' -and -not $inDollar) {
            [void]$buf.Append(';')
            $s = $buf.ToString().Trim()
            # strip leading comments / whitespace
            $cleaned = ($s -split "`n" | Where-Object { $_ -notmatch '^\s*--' -and $_.Trim() -ne '' }) -join "`n"
            if ($cleaned) { $statements += $s }
            [void]$buf.Clear()
            $i++
            continue
        }
        [void]$buf.Append($c)
        $i++
    }
    $tail = $buf.ToString().Trim()
    if ($tail) { $statements += $tail }
    return $statements
}

$stmts = Split-SqlStatements $sql
Write-Host "Found $($stmts.Count) statements"

$ok = 0
$fail = 0
for ($j = 0; $j -lt $stmts.Count; $j++) {
    $stmt = $stmts[$j]
    $preview = ($stmt -split "`n" | Where-Object { $_ -notmatch '^\s*--' -and $_.Trim() -ne '' } | Select-Object -First 1)
    if (-not $preview) { $preview = '(comment-only)'; continue }
    $preview = $preview.Substring(0, [Math]::Min(90, $preview.Length))
    $body = @{ query = $stmt } | ConvertTo-Json -Compress
    try {
        $null = Invoke-RestMethod `
            -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" `
            -Headers @{ Authorization = "Bearer $Pat"; 'Content-Type' = 'application/json' } `
            -Method POST -Body $body
        Write-Host ("[{0,2}/{1}] OK  {2}" -f ($j+1), $stmts.Count, $preview)
        $ok++
    } catch {
        $resp = $_.Exception.Response
        $rd = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $respBody = $rd.ReadToEnd()
        Write-Host ("[{0,2}/{1}] FAIL {2}" -f ($j+1), $stmts.Count, $preview)
        Write-Host "    $($resp.StatusCode.value__): $respBody"
        $fail++
    }
}

Write-Host ""
Write-Host "Done. OK=$ok FAIL=$fail"
