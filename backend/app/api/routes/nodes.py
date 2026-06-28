from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Design, Node
from app.schemas.nodes import NodeCreate, NodeResponse, NodeUpdate

router = APIRouter()


@router.get("", response_model=list[NodeResponse])
async def list_nodes(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[Node]:
    result = await db.execute(select(Node))
    return list(result.scalars().all())


@router.post("", response_model=NodeResponse, status_code=status.HTTP_201_CREATED)
async def create_node(body: NodeCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Node:
    data = body.model_dump()
    # Attach to a design so the node lands on a canvas. Clients that don't send a
    # design_id (e.g. the MCP write tools) would otherwise create design_id=null
    # nodes that exist in the DB but never render in the UI until a container
    # restart reconciles them. Fall back to the first design, matching bulk-approve.
    if data.get("design_id") is None:
        first_design = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        data["design_id"] = first_design.id if first_design else None
    node = Node(**data)
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return node


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Node:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    return node


@router.patch("/{node_id}", response_model=NodeResponse)
async def update_node(
    node_id: str, body: NodeUpdate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> Node:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    await db.commit()
    await db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> None:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    await db.delete(node)
    await db.commit()
