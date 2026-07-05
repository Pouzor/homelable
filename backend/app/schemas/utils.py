def normalize_animated(v: object) -> str:
    """Normalize legacy bool/int animated values to string mode ('none'/'snake'/'flow')."""
    if v is True or v == 1 or v == '1':
        return 'snake'
    if v is False or v == 0 or v == '0' or v is None or v == 'none':
        return 'none'
    if v in ('snake', 'flow', 'basic'):
        return str(v)
    return 'none'


MARKER_SHAPES = {'none', 'arrow', 'arrow-open', 'circle', 'diamond', 'square'}


def normalize_marker(v: object) -> str:
    """Normalize an edge endpoint marker to a shape string.

    Legacy saves stored a boolean (True = filled arrow); coerce those and any
    unknown value to a valid MarkerShape ('none' when off/unknown).
    """
    if v is True or v == 1 or v == '1':
        return 'arrow'
    if v is False or v == 0 or v == '0' or v is None:
        return 'none'
    if isinstance(v, str) and v in MARKER_SHAPES:
        return v
    return 'none'
