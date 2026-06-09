# Remove autostart for Radar Future Bot

$TaskName = "RadarFutureBot"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Autostart removed: $TaskName" -ForegroundColor Green
} else {
    Write-Host "Task not found: $TaskName"
}
