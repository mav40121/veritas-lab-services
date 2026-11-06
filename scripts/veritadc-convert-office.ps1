# scripts/veritadc-convert-office.ps1
#
# Converts legacy Office files for scripts/veritadc-bulk-load.mts, which VeritaDC refuses as they are:
#   .doc -> .docx through Word, keeping the document's own layout (compatibility) mode
#   .ppt -> .pdf  through PowerPoint
# Every source is a private copy made by the caller, opened read-only with macros off and no prompts. It never touches an
# export file. Prints one JSON line per item: counts only (pages, words, tables and so on), never document text. The first
# line is the Office process id, so the caller can stop this instance alone if a file hangs and never touches a person's
# own open Word.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File veritadc-convert-office.ps1 -ListPath list.json
#   list.json: [{ "id": "...", "in": "C:\\short\\path\\abc.doc", "out": "C:\\short\\path\\abc.docx", "kind": "doc" }]
param([Parameter(Mandatory = $true)][string]$ListPath)

$ErrorActionPreference = "Stop"
# Windows PowerShell hands a JSON array down the pipe as one object; ForEach-Object unrolls it into separate items.
$items = @((Get-Content -LiteralPath $ListPath -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ })
$NO_MACROS = 3        # msoAutomationSecurityForceDisable
$FORMAT_DOCX = 16     # wdFormatDocumentDefault
$FORMAT_PDF = 32      # ppSaveAsPDF
# A wrong password makes a protected file fail instead of opening a prompt that nobody can answer.
$NOT_THE_PASSWORD = "veritadc-load-not-a-password"

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

function New-OfficeApp($progId, $processName) {
  $before = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $app = New-Object -ComObject $progId
  Start-Sleep -Milliseconds 400
  $new = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
  if ($new.Count -gt 0) {
    [void]$script:startedPids.Add([int]$new[0])
    Emit @{ officePid = $new[0]; app = $processName }
  }
  return $app
}

function Stats-Word($doc) {
  return @{
    pages = [int]$doc.ComputeStatistics(2)
    words = [int]$doc.ComputeStatistics(0)
    characters = [int]$doc.ComputeStatistics(3)
    paragraphs = [int]$doc.Paragraphs.Count
    tables = [int]$doc.Tables.Count
    inlineShapes = [int]$doc.InlineShapes.Count
    shapes = [int]$doc.Shapes.Count
    comments = [int]$doc.Comments.Count
    revisions = [int]$doc.Revisions.Count
    footnotes = [int]$doc.Footnotes.Count
    sections = [int]$doc.Sections.Count
  }
}

$script:startedPids = New-Object System.Collections.ArrayList
$word = $null
$ppt = $null
try {
  foreach ($item in $items) {
    try {
      if ($item.kind -eq "doc") {
        if (-not $word) {
          $word = New-OfficeApp "Word.Application" "WINWORD"
          $word.Visible = $false
          $word.DisplayAlerts = 0
          $word.AutomationSecurity = $NO_MACROS
          $word.Options.DoNotPromptForConvert = $true
          $word.Options.SaveNormalPrompt = $false
        }
        # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, PasswordTemplate, Revert, WritePasswordDocument
        $doc = $word.Documents.Open($item.in, $false, $true, $false, $NOT_THE_PASSWORD, $NOT_THE_PASSWORD, $false, $NOT_THE_PASSWORD)
        $before = Stats-Word $doc
        # No compatibility argument: the converted file keeps the layout mode the .doc had.
        $doc.SaveAs2($item.out, $FORMAT_DOCX)
        $doc.Close(0)
        $check = $word.Documents.Open($item.out, $false, $true, $false)
        $after = Stats-Word $check
        $check.Close(0)
        Emit @{ id = $item.id; ok = $true; kind = "doc"; before = $before; after = $after }
      }
      elseif ($item.kind -eq "ppt") {
        if (-not $ppt) {
          $ppt = New-OfficeApp "PowerPoint.Application" "POWERPNT"
          $ppt.AutomationSecurity = $NO_MACROS
          $ppt.DisplayAlerts = 1
        }
        # FileName, ReadOnly (true), Untitled (false), WithWindow (false)
        $p = $ppt.Presentations.Open($item.in, -1, 0, 0)
        $slides = [int]$p.Slides.Count
        $p.SaveAs($item.out, $FORMAT_PDF)
        $p.Close()
        Emit @{ id = $item.id; ok = $true; kind = "ppt"; before = @{ slides = $slides }; after = @{} }
      }
      else {
        Emit @{ id = $item.id; ok = $false; error = "unknown kind" }
      }
    }
    catch {
      # The reason only, which names no document content.
      Emit @{ id = $item.id; ok = $false; error = ($_.Exception.Message -replace '[\r\n]+', ' ' -replace '"[^"]*"', '""').Substring(0, [Math]::Min(160, ($_.Exception.Message -replace '[\r\n]+', ' ' -replace '"[^"]*"', '""').Length)) }
    }
  }
}
finally {
  if ($word) { try { $word.Quit(0) } catch {} ; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  if ($ppt) { try { $ppt.Quit() } catch {} ; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) }
  $word = $null
  $ppt = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Start-Sleep -Seconds 2
  # A hidden Office process that outlives Quit would hold memory on this PC. Only the ones this run started are touched.
  foreach ($officePid in $script:startedPids) { Stop-Process -Id $officePid -Force -ErrorAction SilentlyContinue }
}
