export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg px-6 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <span
          className="text-2xl font-black tracking-[0.05em] text-ink"
          style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
        >
          cadencia
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-ink-3">Last updated: November 2026</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-2">
          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">1. Who we are</h2>
            <p>
              Cadencia is a training platform operated by LineUps FanXperience Inc. It is a closed,
              invite-only application built for a small group of endurance athletes to plan workouts
              and track training data together. It is not open to public sign-up.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">2. What data we collect</h2>
            <p>When you use Cadencia, we collect and store:</p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>Account information: your name, email address, and password (stored securely via Supabase Auth; we never see your plain-text password).</li>
              <li>Training data you enter: planned workouts, notes, personal bests, training zones, goal race information, and body metrics you choose to provide (e.g. height, weight, resting/max heart rate).</li>
              <li>
                Activity data from connected fitness platforms, if and when you choose to connect them:
                Strava, COROS, and/or Garmin Connect (via your own Garmin Personal API key). This
                includes activity summaries such as pace, distance, duration, heart rate, cadence,
                power, and GPS route data, as made available by each platform&apos;s API.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">3. How we use your data</h2>
            <p>
              Your data is used solely to operate Cadencia for you and the other athletes you train
              with: displaying your training calendar and activity history, computing training zones
              and estimates, and (when you opt in) matching synced activities to your planned
              workouts. We do not sell your data, and we do not use it for advertising.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">4. Third parties we use</h2>
            <ul className="ml-5 list-disc space-y-1">
              <li><strong>Supabase</strong>: our database and authentication provider. All application data is stored there.</li>
              <li><strong>Vercel</strong>: hosts this application.</li>
              <li><strong>Strava, COROS, and Garmin</strong>: only for the specific athlete who connects their own account with that platform, to sync their own activity data.</li>
              <li><strong>Anthropic (Claude API)</strong>: used in a best-effort way to generate short written summaries of a completed workout, written back onto the matching Strava activity. Only the specific activity&apos;s own summary data (duration, distance, pace, etc.) is sent for this purpose.</li>
            </ul>
            <p className="mt-2">We do not use any advertising, tracking, or analytics platforms.</p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">5. Sharing within the app</h2>
            <p>
              Cadencia is a shared training log among a small, trusted, invite-only group. Other
              athletes in your group can see your training calendar and activity data. This is a
              core, intentional feature of the app, not an accidental exposure. Nobody outside your
              invited group can access your data.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">6. Your choices</h2>
            <p>
              You can disconnect Strava, COROS, or Garmin at any time from your Settings page, which
              removes the stored connection credentials immediately. You can ask an administrator of
              your Cadencia group to delete your account and data entirely.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">7. Contact</h2>
            <p>
              Questions about this policy or your data can be sent to{" "}
              <a href="mailto:josemiguel.espi188@gmail.com" className="underline">
                josemiguel.espi188@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
