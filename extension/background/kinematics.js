// Human Browser Copilot - Kinematics & Human Behavior Engine

export const PROFILES = {
  speedy: {
    name: "Speedy",
    mouseSpeedMultiplier: 0.4,
    typingWpm: 120,
    jitterMagnitude: 0.5,
    readingDwellPerCharMs: 2,
    typoRate: 0.00
  },
  natural: {
    name: "Natural",
    mouseSpeedMultiplier: 1.0,
    typingWpm: 65,
    jitterMagnitude: 1.2,
    readingDwellPerCharMs: 8,
    typoRate: 0.02
  },
  deep_reader: {
    name: "Deep Reader",
    mouseSpeedMultiplier: 1.4,
    typingWpm: 45,
    jitterMagnitude: 1.8,
    readingDwellPerCharMs: 18,
    typoRate: 0.03
  },
  ghost_stealth: {
    name: "Ghost Stealth",
    mouseSpeedMultiplier: 1.2,
    typingWpm: 55,
    jitterMagnitude: 2.2,
    readingDwellPerCharMs: 12,
    typoRate: 0.015
  }
};

/**
 * Generate smooth Cubic Bézier curve trajectory between two points
 */
export function generateBezierPath(startX, startY, targetX, targetY, profileKey = "natural") {
  const profile = PROFILES[profileKey] || PROFILES.natural;
  const distance = Math.hypot(targetX - startX, targetY - startY);
  
  // Number of intermediate control steps based on distance & speed
  const baseSteps = Math.max(12, Math.min(80, Math.floor(distance / 8)));
  const steps = Math.floor(baseSteps * profile.mouseSpeedMultiplier);

  // Generate 2 realistic control points with random arching
  const midX = (startX + targetX) / 2;
  const midY = (startY + targetY) / 2;
  const perpX = -(targetY - startY);
  const perpY = targetX - startX;
  const perpLen = Math.hypot(perpX, perpY) || 1;

  const archAmount = (Math.random() - 0.5) * Math.min(distance * 0.4, 180);
  const cp1X = startX + (targetX - startX) * 0.25 + (perpX / perpLen) * archAmount;
  const cp1Y = startY + (targetY - startY) * 0.25 + (perpY / perpLen) * archAmount;
  const cp2X = startX + (targetX - startX) * 0.75 + (perpX / perpLen) * (archAmount * 0.7);
  const cp2Y = startY + (targetY - startY) * 0.75 + (perpY / perpLen) * (archAmount * 0.7);

  const points = [];

  for (let i = 0; i <= steps; i++) {
    // Ease-in ease-out parameter t
    const tLinear = i / steps;
    // Cubic ease-in-out easing
    const t = tLinear < 0.5 
      ? 4 * tLinear * tLinear * tLinear 
      : 1 - Math.pow(-2 * tLinear + 2, 3) / 2;

    // Cubic Bézier calculation
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    let x = uuu * startX + 3 * uu * t * cp1X + 3 * u * tt * cp2X + ttt * targetX;
    let y = uuu * startY + 3 * uu * t * cp1Y + 3 * u * tt * cp2Y + ttt * targetY;

    // Add sub-pixel micro-jitter except near the very end
    if (i > 0 && i < steps) {
      const jitter = (Math.random() - 0.5) * profile.jitterMagnitude;
      x += jitter;
      y += jitter;
    }

    // Dynamic per-step sleep time (faster in the middle, slower at start/end)
    const stepDelay = Math.max(4, Math.floor(16 * (1 - Math.sin(tLinear * Math.PI) * 0.5)));

    points.push({ x: Math.round(x), y: Math.round(y), delay: stepDelay });
  }

  // Ensure exact target is last point
  points.push({ x: targetX, y: targetY, delay: 20 });
  return points;
}

/**
 * Calculate natural human keystroke delay (ms) for a given character
 */
export function getKeystrokeDelay(char, profileKey = "natural") {
  const profile = PROFILES[profileKey] || PROFILES.natural;
  const avgDelayMs = (60000 / (profile.typingWpm * 5)); // approx 5 chars per word

  // Base random variance
  let delay = avgDelayMs * (0.6 + Math.random() * 0.8);

  // Longer pause on spaces (thinking between words)
  if (char === " ") {
    delay += 50 + Math.random() * 80;
  }
  // Pause on punctuation
  else if ([".", ",", "!", "?", ";", ":", "\n"].includes(char)) {
    delay += 90 + Math.random() * 120;
  }
  // Pause on capitals (simulating shift key press)
  else if (char === char.toUpperCase() && char !== char.toLowerCase()) {
    delay += 30 + Math.random() * 40;
  }

  return Math.max(25, Math.floor(delay));
}

/**
 * Generate organic scroll steps with momentum deceleration
 */
export function generateScrollSteps(distanceY, profileKey = "natural") {
  const profile = PROFILES[profileKey] || PROFILES.natural;
  const steps = Math.max(5, Math.min(25, Math.floor(Math.abs(distanceY) / 40)));
  const results = [];
  let remaining = distanceY;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    // Deceleration factor
    const fraction = (1 - t) * 0.25 + 0.05;
    const delta = i === steps - 1 ? remaining : Math.round(distanceY * fraction);
    remaining -= delta;

    const delay = Math.max(10, Math.floor(25 * (1 + t * 0.5) * profile.mouseSpeedMultiplier));
    results.push({ deltaY: delta, delay });
  }

  return results;
}
