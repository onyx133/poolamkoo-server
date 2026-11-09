export class HealthService {
  constructor(private readonly version: string) {}

  status(): { status: 'ok'; version: string } {
    return { status: 'ok', version: this.version };
  }
}
