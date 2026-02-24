# 基于Model-Reaction库的广告创编系统技术方案

## 1. 概述

本技术方案基于现有的model-reaction库，采用模块、组件、数据分层思想，实现一个可扩展、可维护的广告创编系统。系统支持广告基本信息设置、创意内容管理、精准投放配置等核心功能。其中数据部分直接采用model-reaction工程方案，数据层负责管理字段信息，并按广告业务领域划分模块字段，业务逻辑内聚在模块内部。

## 2. 架构设计

### 2.1 整体架构
```
┌─────────────────────────┐
│       模块层m            │
│  (Modules Layer)        │
│  ┌───────────────────┐  │
│  │ 业务模块 m          │  │
│  └───────────────────┘  │
└─────────────────────────┘
            │
┌─────────────────────────┐
│       组件层c            │
│  (Components Layer)     │
│  ┌───────────────────┐  │
│  │ UI组件             │  │
│  └───────────────────┘  │
└─────────────────────────┘
            │
┌─────────────────────────┐
│       数据层d            │
│  (Data Layer)           │
│  ┌───────────────────┐  │
│  │ Model-Manager     │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

### 2.2 分层说明

#### 2.2.1 数据层 (Data Layer)

数据层基于model-reaction库实现，负责数据的管理、验证和反应机制。
- 提供统一的数据访问接口
- 实现字段验证和类型检查
- 管理数据之间的依赖关系和自动更新
- 处理数据变更事件

#### 2.2.2 模块层 (Modules Layer)

模块层按照业务领域划分，每个模块负责特定业务领域的数据管理和业务逻辑。
- 封装特定领域的数据结构和业务规则
- 提供领域特定的业务方法
- 管理模块内部的数据一致性
- 协调跨模块的数据交互

#### 2.2.3 组件层 (Components Layer)

组件层负责UI展示和用户交互。
- 展示模块层提供的数据
- 处理用户输入并通过模块层更新数据
- 响应数据变化并更新UI

## 3. 数据层设计

### 3.1 基于Model-Reaction的数据管理

数据层直接采用model-reaction库，利用其提供的核心功能：
- 字段定义和类型检查
- 验证规则和自定义验证
- 反应系统和依赖更新
- 事件机制和数据监听

### 3.2 字段信息管理方案

#### 3.2.1 字段定义

每个字段通过FieldSchema接口进行定义：

```typescript
interface FieldSchema {
    // 字段类型
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'enum';
    // 验证规则
    validator?: Validator[];
    // 默认值
    default?: any;
    // 反应定义
    reaction?: Reaction | Reaction[];
    // 值转换函数
    transform?: (value: any) => any;
}
```

#### 3.2.2 字段管理功能

1. **字段注册**：通过模型定义注册所有字段及其元数据
2. **字段验证**：实时验证字段值的有效性
3. **字段转换**：支持值的自动转换和格式化
4. **字段依赖**：管理字段之间的依赖关系
5. **字段事件**：监听字段值的变化

#### 3.2.3 数据一致性保证

- **脏数据管理**：通过dirtyData追踪未通过验证的数据
- **事务性操作**：支持批量字段更新
- **原子性验证**：单个字段或全量字段验证

## 4. 模块层设计

### 4.1 模块划分原则

按照业务领域进行模块划分，每个模块代表一个业务概念：

- **广告模块(AdModule)**：管理广告创意、投放设置等核心广告数据和业务逻辑
- **广告分析模块(AdAnalyticsModule)**：管理广告投放效果数据和分析逻辑
- **受众模块(AudienceModule)**：管理目标受众群体数据
- **平台模块(PlatformModule)**：管理支持的投放平台配置

### 4.2 模块结构设计

每个模块包含以下组件：

1. **模型定义**：定义模块相关的所有字段和验证规则
2. **业务方法**：实现模块特定的业务逻辑
3. **事件处理**：处理模块内部和模块间的事件
4. **状态管理**：维护模块内部的状态

### 4.3 按领域划分的模块字段示例

#### 4.3.1 广告模块字段

```typescript
import { ValidationRules, Rule } from 'model-reaction';

const generateAdId = () => `ad_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const minLength = (min: number) => new Rule('minLength', `Min length is ${min}`, (v) => typeof v === 'string' && v.length >= min);
const maxLength = (max: number) => new Rule('maxLength', `Max length is ${max}`, (v) => typeof v === 'string' && v.length <= max);
const oneOf = (options: string[]) => new Rule('oneOf', `Must be one of ${options.join(', ')}`, (v) => options.includes(v));
const url = new Rule('url', 'Invalid URL', (v) => typeof v === 'string' && /^https?:\\/\\//.test(v));
const minItems = (min: number) => new Rule('minItems', `Min items is ${min}`, (v) => Array.isArray(v) && v.length >= min);

const adModelSchema = {
  'basic.adId': {
    type: 'string',
    default: generateAdId()
  },
  'basic.adName': {
    type: 'string',
    validator: [ValidationRules.required, minLength(3), maxLength(50)],
    default: ''
  },
  'basic.status': {
    type: 'enum',
    validator: [oneOf(['draft', 'pending', 'approved', 'rejected', 'active', 'paused'])],
    default: 'draft'
  },
  'basic.createdAt': {
    type: 'date',
    default: new Date()
  },
  'basic.updatedAt': {
    type: 'date',
    default: new Date()
  },
  'creative.title': {
    type: 'string',
    validator: [ValidationRules.required, maxLength(20)],
    default: ''
  },
  'creative.description': {
    type: 'string',
    validator: [ValidationRules.required, maxLength(100)],
    default: ''
  },
  'creative.imageUrl': {
    type: 'string',
    validator: [ValidationRules.required, url],
    default: ''
  },
  'creative.landingPageUrl': {
    type: 'string',
    validator: [ValidationRules.required, url],
    default: ''
  },
  'targeting.budget': {
    type: 'number',
    validator: [ValidationRules.required, ValidationRules.min(100)],
    default: 1000
  },
  'targeting.dailyBudget': {
    type: 'number',
    validator: [ValidationRules.required, ValidationRules.min(10)],
    default: 100
  },
  'targeting.startDate': {
    type: 'date',
    validator: [ValidationRules.required],
    default: new Date()
  },
  'targeting.endDate': {
    type: 'date',
    validator: [ValidationRules.required],
    default: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  },
  'targeting.targetAudience': {
    type: 'array',
    default: []
  },
  'targeting.platforms': {
    type: 'array',
    validator: [ValidationRules.required, minItems(1)],
    default: []
  }
};
```

#### 4.3.2 广告分析模块字段

```typescript
const adAnalyticsSchema = {
  'adReference.adId': {
    type: 'string',
    validator: [ValidationRules.required],
    default: ''
  },
  'impressions.total': {
    type: 'number',
    default: 0
  },
  'impressions.unique': {
    type: 'number',
    default: 0
  },
  'impressions.byPlatform': {
    type: 'object',
    default: {}
  },
  'clicks.total': {
    type: 'number',
    default: 0
  },
  'clicks.ctr': {
    type: 'number',
    default: 0
  }
};
```

## 5. 模块实现示例 (React)

### 5.1 广告模块实现

```tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { createModel, ValidationRules, Rule } from '../src/index';
import { ModelReturn, ValidationError } from '../src/types';

// 广告创意接口
interface AdCreative {
  title: string;
  description: string;
  imageUrl: string;
  landingPageUrl: string;
}

// 广告投放设置接口
interface AdTargeting {
  budget: number;
  dailyBudget: number;
  startDate: Date;
  endDate: Date;
  targetAudience: string[];
  platforms: string[];
}

// 广告信息接口
interface AdInfo {
  adId: string;
  adName: string;
  status: string;
  creative: AdCreative;
  targeting: AdTargeting;
  createdAt: Date;
  updatedAt: Date;
}

// 广告上下文接口
interface AdContextType {
  adModel: ModelReturn;
  setAdBasicInfo: (info: { adName: string; status: string }) => Promise<boolean>;
  setAdCreative: (creative: AdCreative) => Promise<boolean>;
  setAdTargeting: (targeting: AdTargeting) => Promise<boolean>;
  validateAd: () => Promise<boolean>;
  getAdInfo: () => AdInfo;
  submitAd: () => Promise<boolean>;
  validationErrors: Record<string, ValidationError[]>;
  isLoading: boolean;
}

// 创建广告上下文
const AdContext = createContext<AdContextType | undefined>(undefined);

// 广告模块提供者组件
export const AdProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [validationErrors, setValidationErrors] = useState<Record<string, ValidationError[]>>({});
  const [isLoading, setIsLoading] = useState(false);

  // 生成广告ID
  const generateAdId = (): string => {
    return 'AD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  };

  // 初始化广告模型
  const minLength = (min: number) => new Rule('minLength', `Min length is ${min}`, (v) => typeof v === 'string' && v.length >= min);
  const maxLength = (max: number) => new Rule('maxLength', `Max length is ${max}`, (v) => typeof v === 'string' && v.length <= max);
  const oneOf = (options: string[]) => new Rule('oneOf', `Must be one of ${options.join(', ')}`, (v) => options.includes(v));
  const url = new Rule('url', 'Invalid URL', (v) => typeof v === 'string' && /^https?:\\/\\//.test(v));
  const minItems = (min: number) => new Rule('minItems', `Min items is ${min}`, (v) => Array.isArray(v) && v.length >= min);

  const adModel = createModel({
    // 基本信息
    'basic.adId': {
      type: 'string',
      default: generateAdId()
    },
    'basic.adName': {
      type: 'string',
      validator: [ValidationRules.required, minLength(3), maxLength(50)],
      default: ''
    },
    'basic.status': {
      type: 'string',
      validator: [oneOf(['draft', 'pending', 'approved', 'rejected', 'active', 'paused'])],
      default: 'draft'
    },
    'basic.createdAt': {
      type: 'date',
      default: new Date()
    },
    'basic.updatedAt': {
      type: 'date',
      default: new Date()
    },

    // 创意信息
    'creative.title': {
      type: 'string',
      validator: [ValidationRules.required, maxLength(20)],
      default: ''
    },
    'creative.description': {
      type: 'string',
      validator: [ValidationRules.required, maxLength(100)],
      default: ''
    },
    'creative.imageUrl': {
      type: 'string',
      validator: [ValidationRules.required, url],
      default: ''
    },
    'creative.landingPageUrl': {
      type: 'string',
      validator: [ValidationRules.required, url],
      default: ''
    },

    // 投放设置
    'targeting.budget': {
      type: 'number',
      validator: [ValidationRules.required, ValidationRules.min(100)],
      default: 1000
    },
    'targeting.dailyBudget': {
      type: 'number',
      validator: [ValidationRules.required, ValidationRules.min(10)],
      default: 100
    },
    'targeting.startDate': {
      type: 'date',
      validator: [ValidationRules.required],
      default: new Date()
    },
    'targeting.endDate': {
      type: 'date',
      validator: [ValidationRules.required],
      default: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 默认30天后
    },
    'targeting.targetAudience': {
      type: 'array',
      default: []
    },
    'targeting.platforms': {
      type: 'array',
      validator: [ValidationRules.required, minItems(1)],
      default: []
    }
  });

  // 监听验证错误变化
  useEffect(() => {
    const handleFieldChange = () => {
      setValidationErrors({ ...adModel.validationErrors });
    };

    adModel.on('field:change', handleFieldChange);

    return () => {
      adModel.off('field:change', handleFieldChange);
    };
  }, [adModel]);

  // 设置广告基本信息
  const setAdBasicInfo = async (info: { adName: string; status: string }): Promise<boolean> => {
    setIsLoading(true);
    try {
      return await adModel.setFields({
        'basic.adName': info.adName,
        'basic.status': info.status,
        'basic.updatedAt': new Date()
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 设置广告创意信息
  const setAdCreative = async (creative: AdCreative): Promise<boolean> => {
    setIsLoading(true);
    try {
      return await adModel.setFields({
        'creative.title': creative.title,
        'creative.description': creative.description,
        'creative.imageUrl': creative.imageUrl,
        'creative.landingPageUrl': creative.landingPageUrl,
        'basic.updatedAt': new Date()
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 设置广告投放信息
  const setAdTargeting = async (targeting: AdTargeting): Promise<boolean> => {
    setIsLoading(true);
    try {
      return await adModel.setFields({
        'targeting.budget': targeting.budget,
        'targeting.dailyBudget': targeting.dailyBudget,
        'targeting.startDate': targeting.startDate,
        'targeting.endDate': targeting.endDate,
        'targeting.targetAudience': targeting.targetAudience,
        'targeting.platforms': targeting.platforms,
        'basic.updatedAt': new Date()
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 验证广告数据
  const validateAd = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      return await adModel.validateAll();
    } finally {
      setIsLoading(false);
    }
  };

  // 获取广告信息
  const getAdInfo = (): AdInfo => {
    const data = adModel.data;
    return {
      adId: data['basic.adId'],
      adName: data['basic.adName'],
      status: data['basic.status'],
      creative: {
        title: data['creative.title'],
        description: data['creative.description'],
        imageUrl: data['creative.imageUrl'],
        landingPageUrl: data['creative.landingPageUrl']
      },
      targeting: {
        budget: data['targeting.budget'],
        dailyBudget: data['targeting.dailyBudget'],
        startDate: data['targeting.startDate'],
        endDate: data['targeting.endDate'],
        targetAudience: data['targeting.targetAudience'],
        platforms: data['targeting.platforms']
      },
      createdAt: data['basic.createdAt'],
      updatedAt: data['basic.updatedAt']
    };
  };

  // 提交广告
  const submitAd = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      // 先验证广告数据
      const isValid = await validateAd();
      if (!isValid) return false;

      // 更新广告状态为待审核
      return await adModel.setFields({
        'basic.status': 'pending',
        'basic.updatedAt': new Date()
      });
    } finally {
      setIsLoading(false);
    }
  };

  const value: AdContextType = {
    adModel,
    setAdBasicInfo,
    setAdCreative,
    setAdTargeting,
    validateAd,
    getAdInfo,
    submitAd,
    validationErrors,
    isLoading
  };

  return <AdContext.Provider value={value}>{children}</AdContext.Provider>;
};

// 自定义Hook，方便组件使用广告模块
export const useAd = (): AdContextType => {
  const context = useContext(AdContext);
  if (context === undefined) {
    throw new Error('useAd must be used within an AdProvider');
  }
  return context;
};
```

## 6. 组件层集成示例 (React)

### 6.1 广告创编表单组件

```tsx
import React, { useState } from 'react';
import { useAd } from './modules/ad-module';

const AdCreationForm: React.FC = () => {
  const { 
    setAdBasicInfo, 
    setAdCreative, 
    setAdTargeting, 
    submitAd, 
    validationErrors, 
    isLoading 
  } = useAd();
  
  // 表单数据状态
  const [activeTab, setActiveTab] = useState<'basic' | 'creative' | 'targeting'>('basic');
  const [basicInfo, setBasicInfo] = useState({
    adName: ''
  });
  const [creativeInfo, setCreativeInfo] = useState({
    title: '',
    description: '',
    imageUrl: '',
    landingPageUrl: ''
  });
  const [targetingInfo, setTargetingInfo] = useState({
    budget: '1000',
    dailyBudget: '100',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    targetAudience: [] as string[],
    selectedPlatforms: [] as string[]
  });
  const [customAudience, setCustomAudience] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // 可选平台列表
  const availablePlatforms = [
    { id: 'web', name: '网站' },
    { id: 'app', name: '应用' },
    { id: 'wechat', name: '微信' },
    { id: 'douyin', name: '抖音' },
    { id: 'kuaishou', name: '快手' }
  ];

  // 获取字段错误信息
  const getFieldErrors = (field: string) => {
    return Object.entries(validationErrors)
      .filter(([key]) => key === field)
      .flatMap(([_, errors]) => errors.map(error => error.message));
  };

  // 处理基本信息输入变化
  const handleBasicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBasicInfo(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // 处理创意信息输入变化
  const handleCreativeChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCreativeInfo(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // 处理投放设置输入变化
  const handleTargetingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTargetingInfo(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // 处理平台选择
  const handlePlatformToggle = (platformId: string) => {
    setTargetingInfo(prev => ({
      ...prev,
      selectedPlatforms: prev.selectedPlatforms.includes(platformId)
        ? prev.selectedPlatforms.filter(id => id !== platformId)
        : [...prev.selectedPlatforms, platformId]
    }));
  };

  // 添加自定义受众
  const handleAddAudience = () => {
    if (customAudience.trim() && !targetingInfo.targetAudience.includes(customAudience.trim())) {
      setTargetingInfo(prev => ({
        ...prev,
        targetAudience: [...prev.targetAudience, customAudience.trim()]
      }));
      setCustomAudience('');
    }
  };

  // 移除自定义受众
  const handleRemoveAudience = (audience: string) => {
    setTargetingInfo(prev => ({
      ...prev,
      targetAudience: prev.targetAudience.filter(a => a !== audience)
    }));
  };

  // 保存当前标签页数据
  const handleSaveTab = async () => {
    try {
      let success = false;

      switch (activeTab) {
        case 'basic':
          success = await setAdBasicInfo({
            adName: basicInfo.adName,
            status: 'draft'
          });
          break;
        case 'creative':
          success = await setAdCreative({
            title: creativeInfo.title,
            description: creativeInfo.description,
            imageUrl: creativeInfo.imageUrl,
            landingPageUrl: creativeInfo.landingPageUrl
          });
          break;
        case 'targeting':
          success = await setAdTargeting({
            budget: parseFloat(targetingInfo.budget),
            dailyBudget: parseFloat(targetingInfo.dailyBudget),
            startDate: new Date(targetingInfo.startDate),
            endDate: new Date(targetingInfo.endDate),
            targetAudience: targetingInfo.targetAudience,
            platforms: targetingInfo.selectedPlatforms
          });
          break;
      }

      if (success) {
        setMessage({ text: `${getTabTitle(activeTab)}保存成功`, type: 'success' });
      } else {
        setMessage({ text: `${getTabTitle(activeTab)}保存失败，请检查输入`, type: 'error' });
      }
    } catch (error) {
      setMessage({ text: '保存失败，请稍后重试', type: 'error' });
    }
  };

  // 提交广告
  const handleSubmitAd = async () => {
    try {
      // 先保存所有标签页的数据
      await handleSaveTab();
      
      // 提交广告到系统
      const success = await submitAd();
      
      if (success) {
        setMessage({ text: '广告提交成功，等待审核', type: 'success' });
      } else {
        setMessage({ text: '广告提交失败，请检查所有信息', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: '提交失败，请稍后重试', type: 'error' });
    }
  };

  // 获取标签页标题
  const getTabTitle = (tab: string): string => {
    switch (tab) {
      case 'basic': return '基本信息';
      case 'creative': return '广告创意';
      case 'targeting': return '投放设置';
      default: return '';
    }
  };

  // 渲染基本信息表单
  const renderBasicInfoForm = () => (
    <div className="basic-info-form">
      <div className="form-group">
        <label htmlFor="adName">广告名称 *</label>
        <input
          type="text"
          id="adName"
          name="adName"
          value={basicInfo.adName}
          onChange={handleBasicChange}
          placeholder="请输入广告名称（3-50个字符）"
          className={getFieldErrors('basic.adName').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('basic.adName').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
      </div>
    </div>
  );

  // 渲染广告创意表单
  const renderCreativeForm = () => (
    <div className="creative-form">
      <div className="form-group">
        <label htmlFor="title">广告标题 *</label>
        <input
          type="text"
          id="title"
          name="title"
          value={creativeInfo.title}
          onChange={handleCreativeChange}
          placeholder="请输入广告标题（最多20个字符）"
          maxLength={20}
          className={getFieldErrors('creative.title').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('creative.title').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
        <div className="char-count">{creativeInfo.title.length}/20</div>
      </div>

      <div className="form-group">
        <label htmlFor="description">广告描述 *</label>
        <textarea
          id="description"
          name="description"
          value={creativeInfo.description}
          onChange={handleCreativeChange}
          placeholder="请输入广告描述（最多100个字符）"
          maxLength={100}
          rows={3}
          className={getFieldErrors('creative.description').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('creative.description').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
        <div className="char-count">{creativeInfo.description.length}/100</div>
      </div>

      <div className="form-group">
        <label htmlFor="imageUrl">图片URL *</label>
        <input
          type="url"
          id="imageUrl"
          name="imageUrl"
          value={creativeInfo.imageUrl}
          onChange={handleCreativeChange}
          placeholder="请输入图片链接"
          className={getFieldErrors('creative.imageUrl').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('creative.imageUrl').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
      </div>

      <div className="form-group">
        <label htmlFor="landingPageUrl">落地页URL *</label>
        <input
          type="url"
          id="landingPageUrl"
          name="landingPageUrl"
          value={creativeInfo.landingPageUrl}
          onChange={handleCreativeChange}
          placeholder="请输入落地页链接"
          className={getFieldErrors('creative.landingPageUrl').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('creative.landingPageUrl').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
      </div>

      {creativeInfo.imageUrl && (
        <div className="image-preview">
          <h4>图片预览</h4>
          <img src={creativeInfo.imageUrl} alt="广告预览" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </div>
      )}
    </div>
  );

  // 渲染投放设置表单
  const renderTargetingForm = () => (
    <div className="targeting-form">
      <div className="form-group">
        <label htmlFor="budget">总预算（元）*</label>
        <input
          type="number"
          id="budget"
          name="budget"
          value={targetingInfo.budget}
          onChange={handleTargetingChange}
          min="100"
          placeholder="最低100元"
          className={getFieldErrors('targeting.budget').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('targeting.budget').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
      </div>

      <div className="form-group">
        <label htmlFor="dailyBudget">日预算（元）*</label>
        <input
          type="number"
          id="dailyBudget"
          name="dailyBudget"
          value={targetingInfo.dailyBudget}
          onChange={handleTargetingChange}
          min="10"
          placeholder="最低10元"
          className={getFieldErrors('targeting.dailyBudget').length > 0 ? 'error' : ''}
        />
        {getFieldErrors('targeting.dailyBudget').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
      </div>

      <div className="form-row">
        <div className="form-group half">
          <label htmlFor="startDate">开始日期 *</label>
          <input
            type="date"
            id="startDate"
            name="startDate"
            value={targetingInfo.startDate}
            onChange={handleTargetingChange}
            min={new Date().toISOString().split('T')[0]}
            className={getFieldErrors('targeting.startDate').length > 0 ? 'error' : ''}
          />
          {getFieldErrors('targeting.startDate').map((error, index) => (
            <div key={index} className="error-message">{error}</div>
          ))}
        </div>

        <div className="form-group half">
          <label htmlFor="endDate">结束日期 *</label>
          <input
            type="date"
            id="endDate"
            name="endDate"
            value={targetingInfo.endDate}
            onChange={handleTargetingChange}
            min={new Date().toISOString().split('T')[0]}
            className={getFieldErrors('targeting.endDate').length > 0 ? 'error' : ''}
          />
          {getFieldErrors('targeting.endDate').map((error, index) => (
            <div key={index} className="error-message">{error}</div>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>投放平台 *</label>
        <div className="platform-options">
          {availablePlatforms.map(platform => (
            <label key={platform.id} className="platform-option">
              <input
                type="checkbox"
                checked={targetingInfo.selectedPlatforms.includes(platform.id)}
                onChange={() => handlePlatformToggle(platform.id)}
              />
              <span>{platform.name}</span>
            </label>
          ))}
        </div>
        {getFieldErrors('targeting.platforms').map((error, index) => (
          <div key={index} className="error-message">{error}</div>
        ))}
      </div>

      <div className="form-group">
        <label>自定义受众</label>
        <div className="audience-input-group">
          <input
            type="text"
            value={customAudience}
            onChange={(e) => setCustomAudience(e.target.value)}
            placeholder="输入受众标签"
          />
          <button type="button" onClick={handleAddAudience}>添加</button>
        </div>
        {targetingInfo.targetAudience.length > 0 && (
          <div className="audience-tags">
            {targetingInfo.targetAudience.map((audience, index) => (
              <span key={index} className="audience-tag">
                {audience}
                <button type="button" onClick={() => handleRemoveAudience(audience)}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="ad-creation-form">
      <h2>广告创编</h2>
      
      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'basic' ? 'active' : ''}`}
          onClick={() => setActiveTab('basic')}
        >
          基本信息
        </button>
        <button 
          className={`tab ${activeTab === 'creative' ? 'active' : ''}`}
          onClick={() => setActiveTab('creative')}
        >
          广告创意
        </button>
        <button 
          className={`tab ${activeTab === 'targeting' ? 'active' : ''}`}
          onClick={() => setActiveTab('targeting')}
        >
          投放设置
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'basic' && renderBasicInfoForm()}
        {activeTab === 'creative' && renderCreativeForm()}
        {activeTab === 'targeting' && renderTargetingForm()}
      </div>

      <div className="form-actions">
        <button type="button" onClick={handleSaveTab} disabled={isLoading}>
          {isLoading ? '保存中...' : '保存当前页'}
        </button>
        <button type="button" onClick={handleSubmitAd} disabled={isLoading} className="primary">
          {isLoading ? '提交中...' : '提交审核'}
        </button>
      </div>
    </div>
  );
};

export default AdCreationForm;
```

### 6.3 应用主组件

```tsx
import React from 'react';
import { AdProvider } from './modules/ad-module';
import AdCreationForm from './components/AdCreationForm';
import './App.css';

const App: React.FC = () => {
  return (
    <AdProvider>
      <div className="app">
        <header className="app-header">
          <h1>广告创编系统</h1>
          <p className="app-subtitle">基于 Model-Reaction 的高性能广告管理平台</p>
        </header>
        <main className="app-main">
          <section className="ad-creation-section">
            <AdCreationForm />
          </section>
        </main>
        <footer className="app-footer">
          <p>© {new Date().getFullYear()} 广告管理平台 - 所有权利保留</p>
        </footer>
      </div>
    </AdProvider>
  );
};

export default App;
```

## 7. 技术优势

1. **数据一致性**：通过model-reaction的验证和反应机制，确保数据始终保持一致
2. **代码内聚**：业务逻辑内聚在对应模块中，提高代码的可维护性
3. **关注点分离**：清晰的分层设计使得各层职责明确，降低耦合度
4. **可扩展性**：按领域划分模块，便于添加新功能和维护现有功能
5. **类型安全**：基于TypeScript的类型定义，提供良好的类型检查和开发体验

## 8. 总结

本技术方案基于model-reaction库，实现了模块、组件、数据的分层架构。数据层负责管理字段信息和数据验证，模块层按领域划分并内聚业务逻辑，组件层负责UI展示和用户交互。这种设计使得系统具有良好的可维护性、可扩展性和类型安全性，同时通过model-reaction的反应系统，实现了数据的自动更新和一致性管理。
