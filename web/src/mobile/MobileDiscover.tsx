'use client';

import { MIcon } from './MobileKit';

export default function MobileDiscover() {
  return (
    <div className="mdiscover">
      <section className="mdiscover-banner" aria-labelledby="mdiscover-title">
        <span className="mdiscover-icon">{MIcon.discover}</span>
        <span className="mdiscover-kicker">Coming soon</span>
        <h1 id="mdiscover-title">Discover new opportunities</h1>
        <p>Fresh projects, partner resources, and more ways to grow with SquadHub will appear here.</p>
      </section>
    </div>
  );
}
