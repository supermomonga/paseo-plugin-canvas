/** A translation of `Source`: the same keys, any subset, string values. */
export type Localized<Source> = {
  readonly [Key in keyof Source]?: Source[Key] extends string
    ? string
    : Localized<Source[Key]>;
};
