'use client';
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

export const PillTabs = TabsPrimitive.Root;

export const PillTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ style, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    style={{
      display: 'inline-flex',
      gap: 2,
      padding: 3,
      background: 'var(--bg2)',
      borderRadius: 10,
      border: '1px solid var(--border)',
      overflowX: 'auto',
      maxWidth: '100%',
      ...style,
    }}
    {...props}
  />
));
PillTabsList.displayName = 'PillTabsList';

export const PillTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ style, className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '7px 14px',
      borderRadius: 7,
      fontFamily: 'var(--sans)',
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--text3)',
      background: 'transparent',
      border: '1px solid transparent',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      transition: 'background 120ms ease, color 120ms ease, box-shadow 120ms ease',
      ...style,
    }}
    className={`pt-trigger${className ? ` ${className}` : ''}`}
    {...props}
  />
));
PillTabsTrigger.displayName = 'PillTabsTrigger';

export const PillTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ style, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    style={{ marginTop: 18, outline: 'none', ...style }}
    {...props}
  />
));
PillTabsContent.displayName = 'PillTabsContent';

/* Active-state styling via data-attribute — applied as a global rule once. */
export function PillTabsActiveStyle() {
  return (
    <style>{`
      /* !important because the trigger sets idle state via inline style,
         which otherwise wins over stylesheet rules. */
      .pt-trigger[data-state="active"] {
        background: var(--surf) !important;
        color: var(--text) !important;
        box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
      }
    `}</style>
  );
}
