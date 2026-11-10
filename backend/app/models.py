from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Color = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
Finite = Annotated[float, Field(allow_inf_nan=False)]
Family = Literal[
    "book", "phone", "puzzle", "coin", "headphones", "lamp", "flowers", "wallet", "folder", "pen"
]
FORMATS = {"square": (1000, 1000), "landscape": (1200, 630), "portrait": (800, 1200)}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Palette(Model):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[\w-]+$")
    name: str = Field(min_length=1, max_length=60)
    background: list[Color] = Field(min_length=4, max_length=4)
    object: list[Color] = Field(min_length=4, max_length=4)


class Element(Model):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    family: Family
    role: Literal["main", "background"] = "main"
    x: Finite = Field(ge=-5000, le=5000)
    y: Finite = Field(ge=-5000, le=5000)
    angle: Finite = Field(default=0.0, ge=-360, le=360)
    hidden: bool = False
    locked: bool = False


class Scene(Model):
    version: Literal[1] = 1
    title: str = Field(default="Новая композиция", min_length=1, max_length=120)
    format: Literal["square", "landscape", "portrait"] = "landscape"
    detail: Literal["L", "S"] = "L"
    scale: Finite = Field(default=0.4, ge=0.03, le=8)
    palette: Palette
    transparent: bool = False
    elements: list[Element] = Field(default_factory=list, max_length=48)

    @model_validator(mode="after")
    def unique_ids(self):
        if self.detail == "L" and self.scale > 4:
            raise ValueError("Для детализации L максимальный общий масштаб равен 4")
        if len({e.id for e in self.elements}) != len(self.elements):
            raise ValueError("ID экземпляров должны быть уникальными")
        return self

    @property
    def size(self) -> tuple[int, int]:
        return FORMATS[self.format]


class ComposeRequest(Model):
    prompt: str = Field(min_length=1, max_length=1000)
    mode: Literal["components", "metaphor"] = "metaphor"
    format: Literal["square", "landscape", "portrait"] = "landscape"
    detail: Literal["L", "S"] = "L"
    palette: Palette
    seed: int = Field(default=0, ge=0, le=1000000)
    backgrounds: bool = True
    use_ai: bool = True

    @model_validator(mode="after")
    def nonempty_prompt(self):
        if not self.prompt.strip():
            raise ValueError("Опишите идею или назовите предметы")
        return self


class ProjectWrite(Model):
    scene: Scene
    revision: int = Field(default=0, ge=0)
