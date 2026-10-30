// Single source of truth for the Rules, the Waiver and the Privacy summary.
// WAIVER_VERSION must match the server (src/server/app.js); bump both whenever the waiver text changes.

export const WAIVER_VERSION = '2026-10-29';

export const RULES = [
  ['One more kilometer, every day.', 'Day 1 is 1 km (0.62 mi). Day 2 is 2 km. Day 10 is 10 km. The distance due on any day equals the day number, in kilometers, and it never stops climbing.'],
  ['One deadline for the whole world.', 'Every race day runs from 00:00:00 to 23:59:59 UTC, for every runner, everywhere. The site always shows the deadline in UTC and in your own local time, with a live countdown. Your run must be recorded and uploaded before the deadline.'],
  ['Run anywhere.', 'Road, trail, track, park loops, any country. Your route is your choice. Runs must be recorded outdoors with GPS (a watch, phone app, or our built-in tracker) so they can be verified. Treadmill runs cannot be verified and do not count.'],
  ['One run or several. Your call.', 'You can cover the day’s distance in one continuous run or split it into as many runs as you like (for example 10 km in the morning and 8 km at night). Your runs for the day are added together. Each run must start and finish inside the same race day.'],
  ['No minimum pace.', 'Run, jog, hike or walk. The only time limit is the end of the race day.'],
  ['The full distance or you’re out.', 'Your recorded GPS distance for the day must reach the full distance due. Close doesn’t count, and nothing is rounded up. GPS can read slightly short, so run a little extra (we recommend 2–3%).'],
  ['Miss a day and you’re eliminated.', 'If you don’t upload the full distance before the deadline, you’re eliminated when the clock hits 23:59:59 UTC. Elimination is final.'],
  ['Every run is verified.', 'Each upload is automatically checked for date, speed, GPS integrity and duplicates. Suspicious runs are reviewed by race officials. A flagged run counts provisionally until it’s reviewed. If a run is rejected, it doesn’t count, which may eliminate you for that day.'],
  ['Cheat and you’re disqualified.', 'Using a vehicle, bike or scooter, having someone else run for you, uploading old, edited or fabricated files, or running more than one account means disqualification. A disqualified runner loses any placing and prize, forfeits the entry fee, and may be banned from future events.'],
  ['Last legs standing wins.', 'The race ends at the first deadline when one runner or none is left. If the final runners are all eliminated on the same day, the runner with the longest total distance across the whole race places highest. If total distance is exactly equal, the fastest total moving time places highest. 2nd and 3rd place are decided the same way.'],
  ['Prizes for the top three.', '1st, 2nd and 3rd place win prizes, which are announced on the event page before the start.'],
  ['Your safety comes first.', 'Obey traffic laws, run where it is legal and safe, and stop if you feel unwell. No finish is worth a serious injury. Officials’ decisions on verification, eliminations and disqualifications are final.'],
];

export function rulesHTML() {
  return `<ol class="rules">${RULES.map(([t, d]) => `<li><div><b>${t}</b><p>${d}</p></div></li>`).join('')}</ol>`;
}

export const WAIVER_HTML = `
<p><b>PLEASE READ CAREFULLY. THIS IS A LEGAL DOCUMENT THAT AFFECTS YOUR LEGAL RIGHTS. BY SIGNING IT YOU GIVE UP THE RIGHT TO SUE, INCLUDING FOR NEGLIGENCE.</b></p>
<p>Version ${WAIVER_VERSION}</p>

<h3>1. Parties and definitions</h3>
<p>This Participant Waiver, Release of Liability, Assumption of Risk and Indemnity Agreement (the “Agreement”) is entered into by the person registering (“I”, “me”, the “Participant”) in favor of Last Legs Standing and [ORGANIZER LEGAL ENTITY NAME], together with their owners, members, managers, officers, directors, employees, contractors, volunteers, officials, agents, sponsors, partners, prize providers, technology and payment providers, successors and assigns (collectively, the “Releasees”). The “Challenge” means any Last Legs Standing event and every related activity, including training, running, travel to and from running locations, use of the website, apps and tracker, and any prize or award activity.</p>

<h3>2. Nature of the Challenge</h3>
<p>I understand that the Challenge is a self-directed, unsupervised, virtual endurance event. I alone choose where, when and how I run. The Releasees do not select, inspect, control, close or supervise any route, and they provide no course marshals, traffic control, aid stations, medical staff, emergency services, or supervision of any kind. The required daily distance increases by one kilometer every day without limit (for example, 30 km on Day 30, a cumulative total of 465 km), and the Challenge is designed to continue until participants are unable to continue.</p>

<h3>3. Medical fitness</h3>
<p>I confirm that I am physically fit and sufficiently trained to take part. No physician or qualified medical professional has advised me against taking part. I have been advised to consult a physician before taking part and accept full responsibility for my decision whether to do so. I will stop immediately and seek medical help if I experience pain, dizziness, chest discomfort, shortness of breath, confusion or any other warning sign. I agree that no award, placing or prize justifies risking my health.</p>

<h3>4. Assumption of risk</h3>
<p>I understand that running, especially escalating ultra-distance running on consecutive days, involves serious risks, including but not limited to: overuse injuries, stress fractures, sprains, tendon and ligament damage; muscle breakdown (rhabdomyolysis) and kidney injury; dehydration, hyponatremia, heat exhaustion, heat stroke, sunburn, hypothermia and frostbite; cardiac arrhythmia, heart attack, stroke and sudden death; extreme fatigue, sleep deprivation and impaired judgment; falls, uneven or unsafe surfaces, darkness and poor visibility; collisions with motor vehicles, cyclists or other people; animals, insects and plants; weather, lightning, air pollution and natural hazards; crime and assault; and the failure, inaccuracy or unavailability of GPS devices, phones, apps or this website. These risks may cause <b>property damage, illness, serious injury, permanent disability, paralysis or death</b>. Some risks cannot be foreseen. <b>I KNOWINGLY AND VOLUNTARILY ASSUME ALL OF THESE RISKS, KNOWN AND UNKNOWN, INCLUDING THOSE ARISING FROM THE NEGLIGENCE OF THE RELEASEES OR OTHERS, AND I ACCEPT FULL RESPONSIBILITY FOR MY PARTICIPATION.</b></p>

<h3>5. Release and waiver of liability, and covenant not to sue</h3>
<p>To the fullest extent permitted by law, I, for myself and for my heirs, executors, administrators, personal representatives, next of kin and assigns, <b>HEREBY RELEASE, WAIVE, DISCHARGE AND COVENANT NOT TO SUE</b> the Releasees from any and all claims, demands, losses, damages, liabilities, costs and causes of action of any kind, whether known or unknown, arising out of or related to my participation in the Challenge, <b>INCLUDING CLAIMS ARISING FROM THE NEGLIGENCE OF THE RELEASEES</b>, whether passive or active, to the extent permitted by law. This release covers bodily injury, illness, death, property damage and any other loss.</p>

<h3>6. Indemnification</h3>
<p>I agree to defend, indemnify and hold harmless the Releasees from any claim, loss, liability, damage or cost (including reasonable attorneys’ fees) brought by me or any third party arising out of my participation, my conduct, my breach of this Agreement or the Rules, or any injury I cause to another person or their property.</p>

<h3>7. Medical treatment</h3>
<p>I authorize any emergency medical treatment that may be considered necessary for me, and I agree that I am solely responsible for all costs of that treatment and transport. I acknowledge that the Releasees do not provide medical insurance and that I am responsible for maintaining my own health and accident insurance.</p>

<h3>8. Conduct and compliance with laws</h3>
<p>I will obey all traffic laws, posted rules and property rights. I will not trespass, and I will run only where it is lawful and reasonably safe to do so. I will not use any vehicle or mechanical assistance, and I will not let anyone run in my place. I will follow the official Rules, which form part of this Agreement.</p>

<h3>9. Verification, decisions, fees and technology</h3>
<p>I agree that my run data, including GPS tracks, timestamps, speed and sensor data, may be analyzed automatically and reviewed by officials to verify compliance. Decisions by race officials on verification, eliminations, disqualifications, placings and prizes are final. The Releasees are not responsible for device, GPS, connectivity, third-party platform (such as Strava or Garmin) or website failures, and such failures do not entitle me to reinstatement. Entry fees are non-refundable, including if I am eliminated, disqualified or withdraw, except where refunds are required by law. Prizes may be subject to verification, identity checks and applicable taxes, which are my responsibility.</p>

<h3>10. Publicity</h3>
<p>I consent to the publication of my first name, last initial, country, bib number, race status and results on the website and in Challenge communications, and to the use of any photos, quotes or content I voluntarily submit, without compensation.</p>

<h3>11. Age and capacity</h3>
<p>I confirm that I am at least 18 years old, legally competent to sign this Agreement, and not under the influence of anything that impairs my judgment.</p>

<h3>12. Governing law, severability and entire agreement</h3>
<p>This Agreement is governed by the laws of [GOVERNING STATE / JURISDICTION], without regard to conflict-of-law rules, and any dispute will be resolved exclusively in the courts located in [COUNTY, STATE]. This Agreement is intended to be as broad and inclusive as the law allows. If any part is held invalid or unenforceable, that part will be enforced to the maximum extent permitted and the rest will remain in full force. This Agreement, together with the Rules and Privacy Policy, is the entire agreement on this subject and binds my heirs and assigns.</p>

<h3>13. Electronic signature</h3>
<p>I agree that typing my full legal name and checking the acceptance boxes is my electronic signature, with the same legal effect as a handwritten signature, under the U.S. E-SIGN Act and similar laws. A record of my acceptance, including the date, time, waiver version and IP address, will be kept.</p>

<p><b>I HAVE READ THIS AGREEMENT, FULLY UNDERSTAND ITS TERMS, AND UNDERSTAND THAT I AM GIVING UP SUBSTANTIAL RIGHTS, INCLUDING MY RIGHT TO SUE. I SIGN IT FREELY AND VOLUNTARILY, WITHOUT ANY INDUCEMENT, AND INTEND IT TO BE A COMPLETE AND UNCONDITIONAL RELEASE OF ALL LIABILITY TO THE GREATEST EXTENT ALLOWED BY LAW.</b></p>
`;

export const PRIVACY_HTML = `
<h3>The short version</h3>
<p><b>We never sell, rent or trade your personal information.</b> We collect only what we need to run the Challenge, verify runs, and get shirts, medals and prizes to you.</p>

<h3>What we collect</h3>
<ul>
  <li><b>Account &amp; runner details:</b> name, email, date of birth, gender (optional), country, phone, emergency contact, shirt size, and whether you’ve raced before.</li>
  <li><b>Addresses:</b> your shipping address (for shirts, medals and prizes) and billing address.</li>
  <li><b>Payment:</b> card payments are processed by our payment provider. Your full card number never touches our servers.</li>
  <li><b>Run data:</b> the GPS files and tracks you upload or record, including timestamps, distance, pace, heart rate and cadence if present.</li>
  <li><b>Waiver record:</b> your typed signature, the time, the waiver version and your IP address.</li>
</ul>

<h3>What’s public</h3>
<p>Leaderboards and results show only your <b>first name, last initial, country, bib number, status and race statistics</b>. Your route maps, email, phone, birthday and addresses are never public.</p>

<h3>Who we share with</h3>
<p>Only the service providers needed to operate the Challenge (hosting, payments, shipping) and only for that purpose, or when required by law. If you connect Strava, we read only the activities you choose to import.</p>

<h3>How long we keep it</h3>
<p>We keep race records and results to maintain event history. You can ask us to delete your account and personal data at any time, except records we must keep for legal, tax or anti-fraud reasons.</p>

<h3>Your rights</h3>
<p>You can access, correct, export or delete your data by contacting us at [CONTACT EMAIL].</p>
`;
