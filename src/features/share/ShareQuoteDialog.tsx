import { renderCard } from "./quoteCard";
import { ShareImageDialog } from "./ShareImageDialog";

interface Props { quote: string; title: string; author?: string; location?: string; onClose: () => void }

export function ShareQuoteDialog({ quote, title, author, location, onClose }: Props) {
  return (
    <ShareImageDialog
      heading="Share quote"
      alt={`Quote card: ${quote}`}
      caption={`“${quote}” — ${[title, author].filter(Boolean).join(", ")}`}
      fileBase="lumaread-quote"
      render={(format, theme) => renderCard({ quote, title, author, location, format, theme })}
      onClose={onClose}
    />
  );
}
