# PowerShell HTTP server for local development
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3000

$mime = @{
  '.html'  = 'text/html; charset=utf-8'
  '.css'   = 'text/css'
  '.js'    = 'application/javascript'
  '.mjs'   = 'application/javascript'
  '.json'  = 'application/json'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.jpeg'  = 'image/jpeg'
  '.gif'   = 'image/gif'
  '.svg'   = 'image/svg+xml'
  '.ico'   = 'image/x-icon'
  '.woff'  = 'font/woff'
  '.woff2' = 'font/woff2'
  '.webp'  = 'image/webp'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Server running at http://localhost:$port" -ForegroundColor Cyan

while ($listener.IsListening) {
  $ctx  = $listener.GetContext()
  $req  = $ctx.Request
  $resp = $ctx.Response

  $urlPath = $req.Url.LocalPath
  if ($urlPath -eq '/') { $urlPath = '/index.html' }

  $filePath = Join-Path $root $urlPath.TrimStart('/')

  if (Test-Path $filePath -PathType Leaf) {
    $ext         = [IO.Path]::GetExtension($filePath).ToLower()
    $contentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes       = [IO.File]::ReadAllBytes($filePath)
    $resp.ContentType   = $contentType
    $resp.ContentLength64 = $bytes.Length
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $resp.StatusCode = 404
    $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
    $resp.OutputStream.Write($body, 0, $body.Length)
  }
  $resp.OutputStream.Close()
}
