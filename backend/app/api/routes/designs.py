from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Design, Edge, Node
from app.schemas.designs import DesignCreate, DesignResponse, DesignUpdate

router = APIRouter()


@router.get("", response_model=list[DesignResponse])
async def list_designs(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[DesignResponse]:
    designs = (await db.execute(select(Design).order_by(Design.created_at))).scalars().all()
    return [DesignResponse.model_validate(d) for d in designs]


@router.post("", response_model=DesignResponse, status_code=201)
async def create_design(
    body: DesignCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DesignResponse:
    design = Design(name=body.name, design_type=body.design_type)
    db.add(design)
    await db.flush()
    # Create empty canvas state for the new design
    db.add(CanvasState(design_id=design.id))
    await db.commit()
    await db.refresh(design)
    return DesignResponse.model_validate(design)


@router.put("/{design_id}", response_model=DesignResponse)
async def update_design(
    design_id: str,
    body: DesignUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DesignResponse:
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")
    if body.name is not None:
        design.name = body.name
    await db.commit()
    await db.refresh(design)
    return DesignResponse.model_validate(design)


@router.delete("/{design_id}", status_code=204)
async def delete_design(
    design_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> None:
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")
    # Count remaining designs — prevent deleting the last one
    count = (await db.execute(select(Design))).scalars().all()
    if len(count) <= 1:
        raise HTTPException(400, "Cannot delete the only design")
    # Delete associated canvas state, edges, nodes
    cs = await db.get(CanvasState, design_id)
    if cs:
        await db.delete(cs)
    edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    for e in edges:
        await db.delete(e)
    nodes = (await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all()
    for n in nodes:
        await db.delete(n)
    await db.delete(design)
    await db.commit()
