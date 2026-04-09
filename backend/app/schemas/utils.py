def normalize_animated(v: object) -> str:
    """Normalize legacy bool/int animated values to string mode ('none'/'snake'/'flow')."""
    if v is True or v == 1 or v == '1':
        return 'snake'
    if v is False or v == 0 or v == '0' or v is None or v == 'none':
        return 'none'
    if v in ('snake', 'flow', 'basic'):
        return str(v)
    return 'none'
