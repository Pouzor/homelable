from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Node
from app.schemas.nodes import NodeCreate, NodeResponse, NodeUpdate

router = APIRouter()


@router.get("", response_model=list[NodeResponse])
async def list_nodes(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    result = await db.execute(select(Node))
    return result.scalars().all()


@router.post("", response_model=NodeResponse, status_code=status.HTTP_201_CREATED)
async def create_node(body: NodeCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    node = Node(**body.model_dump())
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return node


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    return node


@router.patch("/{node_id}", response_model=NodeResponse)
async def update_node(
    node_id: str, body: NodeUpdate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
):
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    await db.commit()
    await db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    await db.delete(node)
    await db.commit()
