const axios = require('axios');

class Telemetry {
  constructor() {
    this.supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    this.supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    this.enabled = !!(this.supabaseUrl && this.supabaseAnonKey);
    console.log(`[Telemetry] Initialized. Enabled: ${this.enabled}`);
    if (!this.enabled) {
      console.log(`[Telemetry] Missing URL: ${!!this.supabaseUrl}, Missing Key: ${!!this.supabaseAnonKey}`);
    }
  }

  async trackEvent({ event, userId, platform, meta, version }) {
    if (!this.enabled) {
      console.log(`[Telemetry] Skipping event "${event}" because telemetry is disabled.`);
      return;
    }

    const data = {
      product: 'desktop',
      event,
      user_id: userId,
      platform: platform || process.platform,
      meta,
      version: version || '0.0.1',
    };

    console.log(`[Telemetry] Tracking event: ${event}`, data);

    try {
      // Non-blocking fire and forget
      axios.post(`${this.supabaseUrl}/rest/v1/events`, data, {
        headers: {
          'apikey': this.supabaseAnonKey,
          'Authorization': `Bearer ${this.supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        timeout: 5000,
      }).then(() => {
        console.log(`[Telemetry] Event "${event}" sent successfully.`);
      }).catch((err) => {
        console.error(`[Telemetry] Failed to send event "${event}":`, err.message);
      });
    } catch (e) {
      console.error(`[Telemetry] Error in trackEvent for "${event}":`, e.message);
    }
  }
}

module.exports = new Telemetry();
