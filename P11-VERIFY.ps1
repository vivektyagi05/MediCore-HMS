$ErrorActionPreference = 'Stop'
Write-Host 'MediCore P11 verification' -ForegroundColor Cyan
Write-Host '1/3 Frontend lint'
npm run lint
Write-Host '2/3 Frontend build'
npm run build
Write-Host '3/3 Backend tests'
npm run test:backend
Write-Host 'P11 verification commands completed.' -ForegroundColor Green
