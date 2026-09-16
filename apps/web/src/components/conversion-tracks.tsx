"use client";

import {
  CONVERSION_TRACK_BADGES,
  CONVERSION_TRACK_HINTS,
  CONVERSION_TRACK_LABELS,
  CONVERSION_TRACKS,
  type ConversionTrack,
  parseRunTracks,
} from "@migrator/shared";
import { Badge } from "@/components/ui/badge";

export function toggleTrack(
  selected: ConversionTrack[],
  track: ConversionTrack,
): ConversionTrack[] {
  const next = selected.includes(track)
    ? selected.filter((item) => item !== track)
    : [...selected, track];
  return CONVERSION_TRACKS.filter((item) => next.includes(item));
}

export function ConversionTrackPicker({
  tracks,
  onChange,
  disabled = false,
}: {
  tracks: ConversionTrack[];
  onChange: (tracks: ConversionTrack[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">What this run converts</legend>
      <div className="space-y-2">
        {CONVERSION_TRACKS.map((track) => (
          <label key={track} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={tracks.includes(track)}
              onChange={() => onChange(toggleTrack(tracks, track))}
            />
            <span>
              <span className="font-medium">{CONVERSION_TRACK_LABELS[track]}</span>
              <span className="block text-muted">{CONVERSION_TRACK_HINTS[track]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TrackBadges({ stats }: { stats: Record<string, unknown> }) {
  return (
    <>
      {parseRunTracks(stats).map((track) => (
        <Badge key={track}>{CONVERSION_TRACK_BADGES[track]}</Badge>
      ))}
    </>
  );
}
