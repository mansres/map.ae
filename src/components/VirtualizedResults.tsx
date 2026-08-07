import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { RentalGroup } from '../types/rental';
import { PropertyCard } from './PropertyCard';

type VirtualizedResultsProps = {
    groups: readonly RentalGroup[];
    selectedGroupKey: string | null;
    hoveredGroupKey?: string | null;
    favorites: ReadonlySet<string>;
    compact?: boolean;
    onSelect: (key: string) => void;
    onHover?: (key: string | null) => void;
    onToggleFavorite: (key: string) => void;
};

export function VirtualizedResults({
    groups,
    selectedGroupKey,
    hoveredGroupKey = null,
    favorites,
    compact = false,
    onSelect,
    onHover,
    onToggleFavorite
}: VirtualizedResultsProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: groups.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => compact ? 118 : 152,
        overscan: 6
    });

    if (!groups.length) {
        return (
            <div className="empty-state" role="status">
                <h2>No rentals match those filters</h2>
                <p>Try widening the budget, bedrooms, or search area.</p>
            </div>
        );
    }

    return (
        <div className="virtual-results" ref={scrollRef} tabIndex={0} aria-label="Rental results">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                    const group = groups[virtualRow.index];
                    return (
                        <div
                            key={group.key}
                            ref={virtualizer.measureElement}
                            data-index={virtualRow.index}
                            className="virtual-results__item"
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                            <PropertyCard
                                group={group}
                                compact={compact}
                                selected={selectedGroupKey === group.key}
                                hovered={hoveredGroupKey === group.key}
                                favorite={favorites.has(group.key)}
                                onSelect={onSelect}
                                onHover={onHover}
                                onToggleFavorite={onToggleFavorite}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
