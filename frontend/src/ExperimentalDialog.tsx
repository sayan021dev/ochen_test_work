import {
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  LocateFixed,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import "./experimental.css";

const steps = [
  {
    title: "Включите общий свет",
    text: "В настройках композиции включите источник. Он управляет проекциями всех предметов. Индивидуальные настройки тени сохраняются.",
    hint: "Сначала снимите выделение с предмета — откроются настройки композиции.",
    image: "light-enable",
    target: [71.85, 20.1],
    label: "Общий источник света",
  },
  {
    title: "Переместите солнце",
    text: "Потяните круглую метку на холсте. Тени меняют направление вслед за светом и остаются закреплены у основания предметов.",
    hint: "Метка также перемещается стрелками клавиатуры. Shift увеличивает шаг.",
    image: "light-drag",
    target: [27.53, 53.75],
    label: "Метка источника на холсте",
  },
  {
    title: "Настройте характер тени",
    text: "Высота источника меняет длину проекции. Плотность делает тень прозрачнее или темнее — выберите мягкий эффект, который подходит композиции.",
    hint: "Это 2D-имитация: исходные блики и освещение самих предметов не перестраиваются.",
    image: "light-fields",
    target: [84.35, 51.81],
    label: "Высота и плотность",
  },
  {
    title: "Своя тень предмета",
    text: "Выключите общий свет и выберите предмет. Включите «Свою тень», затем меняйте её направление, длину и прозрачность. Рамка тени управляет проекцией от опоры.",
    hint: "В обычном редакторе эффекты скрыты. Тени на опорах продолжают работать в обоих режимах.",
    image: "own-shadow",
    target: [73.39, 67.06],
    label: "Переключатель своей тени",
  },
] as const;

export function ExperimentalDialog({
  open,
  onClose,
  onShow,
}: {
  open: boolean;
  onClose: () => void;
  onShow: (step: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [step, setStep] = useState(0);
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    const node = dialog.current!;
    if (open) {
      setStep(0);
      setDetail(false);
      if (!node.open) node.showModal();
    } else if (node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  const current = steps[step];
  const next = (value: number) => {
    setStep(value);
    setDetail(false);
  };
  const [tx, ty] = current.target;
  return (
    <dialog
      ref={dialog}
      className="experiment-guide"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="experiment-guide-heading">
        <div>
          <span className="eyebrow">
            <FlaskConical size={14} /> ЭКСПЕРИМЕНТ
          </span>
          <h2 id={`${id}-title`}>Свет и тень: короткий маршрут</h2>
        </div>
        <button
          className="icon"
          aria-label="Закрыть инструкцию"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <nav className="experiment-guide-steps" aria-label="Шаги инструкции">
        {steps.map((item, index) => (
          <button
            key={item.image}
            aria-label={`Шаг ${index + 1}: ${item.title}`}
            aria-current={step === index ? "step" : undefined}
            onClick={() => next(index)}
          >
            <span>{index + 1}</span>
            <span>
              {
                ["Включить свет", "Передвинуть", "Настроить", "Своя тень"][
                  index
                ]
              }
            </span>
          </button>
        ))}
      </nav>
      <div className="experiment-guide-image">
        <img
          src={`/guide/${current.image}.png`}
          alt={`Скриншот экспериментального редактора: ${current.label}`}
        />
        <svg
          className="experiment-guide-arrow"
          viewBox="0 0 100 59.5"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id={`${id}-arrow`}
              markerWidth="5"
              markerHeight="5"
              refX="4"
              refY="2.5"
              orient="auto"
            >
              <path
                d="M0 0 5 2.5 0 5"
                fill="none"
                stroke="#ff68a4"
                strokeWidth="1.4"
              />
            </marker>
          </defs>
          <path
            d={`M ${Math.max(8, tx - 23)} ${Math.max(6, ty * 0.595 - 12)} Q ${tx - 8} ${Math.max(6, ty * 0.595 - 16)} ${tx - 1.8} ${ty * 0.595 - 1.8}`}
            fill="none"
            stroke="#1d1d20"
            strokeWidth="1.4"
          />
          <path
            d={`M ${Math.max(8, tx - 23)} ${Math.max(6, ty * 0.595 - 12)} Q ${tx - 8} ${Math.max(6, ty * 0.595 - 16)} ${tx - 1.8} ${ty * 0.595 - 1.8}`}
            fill="none"
            stroke="#ff68a4"
            strokeWidth=".55"
            markerEnd={`url(#${id}-arrow)`}
          />
        </svg>
        <button
          className="experiment-guide-hotspot"
          style={{ left: `${tx}%`, top: `${ty}%` }}
          aria-label={`Подробнее: ${current.label}`}
          aria-expanded={detail}
          onClick={() => setDetail(!detail)}
        >
          {step + 1}
        </button>
        {detail && (
          <div className="experiment-guide-tooltip" role="status">
            {current.label}. Нажмите «Показать в редакторе», чтобы перейти к
            этому инструменту.
          </div>
        )}
        <span className="experiment-guide-caption">
          Реальный интерфейс · пример композиции
        </span>
      </div>
      <div className="experiment-guide-copy">
        <div>
          <span className="eyebrow">ШАГ {step + 1} ИЗ 4</span>
          <h3>{current.title}</h3>
        </div>
        <div>
          <p id={`${id}-description`}>{current.text}</p>
          <p className="help-text">{current.hint}</p>
        </div>
      </div>
      <footer className="experiment-guide-footer">
        <button
          className="secondary"
          disabled={step === 0}
          onClick={() => next(step - 1)}
        >
          <ArrowLeft size={15} />
          Назад
        </button>
        <button className="text-button" onClick={() => onShow(step)}>
          <LocateFixed size={16} />
          Показать в редакторе
        </button>
        {step < steps.length - 1 ? (
          <button className="primary" onClick={() => next(step + 1)}>
            Далее
            <ArrowRight size={16} />
          </button>
        ) : (
          <button className="primary" onClick={onClose}>
            Попробовать
            <ArrowRight size={16} />
          </button>
        )}
      </footer>
    </dialog>
  );
}
