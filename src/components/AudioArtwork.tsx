import React, { useEffect, useState } from 'react';
import { AudioTrackItem } from '../plugins/audioLibrary';
import {
  getGeneratedAudioArtworkUrl,
  resolveAudioTrackThumbnail,
} from '../utils/audioArtwork';

interface AudioArtworkProps {
  song: AudioTrackItem;
  className?: string;
  alt?: string;
}

export const AudioArtwork: React.FC<AudioArtworkProps> = ({
  song,
  className = 'w-10 h-10 rounded-xl',
  alt,
}) => {
  const fallbackUrl = getGeneratedAudioArtworkUrl(
    song.title || song.displayName,
    song.artist,
    song.id || song.uri || song.title
  );

  const [src, setSrc] = useState<string>(song.thumbnailUrl || fallbackUrl);

  useEffect(() => {
    let active = true;
    if (song.thumbnailUrl) {
      setSrc(song.thumbnailUrl);
      return;
    }

    setSrc(fallbackUrl);
    void resolveAudioTrackThumbnail(song).then((resolved) => {
      if (active && resolved) {
        setSrc(resolved);
      }
    });

    return () => {
      active = false;
    };
  }, [song.id, song.uri, song.thumbnailUrl, song.title, song.artist, fallbackUrl]);

  return (
    <img
      src={src}
      alt={alt || song.title || song.displayName || 'Audio cover art'}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (src !== fallbackUrl) {
          setSrc(fallbackUrl);
        }
      }}
      className={`object-cover select-none ${className}`}
    />
  );
};
