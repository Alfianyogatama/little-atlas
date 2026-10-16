import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { ToyButton } from './ToyButton';
import './country-card.css';

export interface CountryCardImage {
  src: string;
  alt: string;
}

export interface CountryCardProps {
  name: string;
  flag: CountryCardImage | null;
  fact: string | null;
  icon?: CountryCardImage;
  labels: { card: string; close: string; listenAgain: string };
  onClose: () => void;
  onReplay: () => void;
}

export function CountryCard({
  name,
  flag,
  fact,
  icon,
  labels,
  onClose,
  onReplay,
}: CountryCardProps) {
  return (
    <section className="hd-card" aria-label={labels.card}>
      {flag ? <img className="hd-card__flag" src={flag.src} alt={flag.alt} /> : null}
      <div className="hd-card__body">
        <h2 className="hd-card__name">{name}</h2>
        {fact ? (
          <p className="hd-card__fact">
            {icon ? <img className="hd-card__fact-icon" src={icon.src} alt={icon.alt} /> : null}
            <span>{fact}</span>
          </p>
        ) : null}
        <ToyButton
          label={labels.listenAgain}
          icon={<SpeakerHighIcon weight="fill" />}
          showLabel
          onPress={onReplay}
        />
      </div>
      <ToyButton
        className="hd-card__close"
        label={labels.close}
        icon={<XIcon weight="bold" />}
        onPress={onClose}
      />
    </section>
  );
}
